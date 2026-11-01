"""Completion-only LoRA SFT; GPU execution is an explicit separate step."""
from __future__ import annotations

import argparse
import json
import subprocess
import time
from pathlib import Path

from .experiment import file_hash, strict_json
from .model_router import prompt_hash, require_revision, versions
from .prompts import PROMPT_VERSION, SYSTEM_PROMPT, tokenize_example


def read_prepared(directory: Path, smoke: bool) -> tuple[dict, dict]:
    manifest = strict_json((directory / "manifest.json").read_text())
    expected = "smoke_only" if smoke else "formal"
    if manifest["purpose"] != expected:
        raise ValueError(f"data purpose is {manifest['purpose']}; expected {expected}")
    if manifest["prompt_version"] != PROMPT_VERSION or manifest["prompt"] != SYSTEM_PROMPT:
        raise ValueError("prepared prompt is stale; regenerate data")
    splits = ("train",) if smoke else ("train", "validation")
    rows = {}
    for split in splits:
        info = manifest["files"][split]
        if info["name"] != f"{split}.jsonl":
            raise ValueError("unexpected prepared file name")
        path = directory / info["name"]
        if file_hash(path) != info["sha256"]:
            raise ValueError(f"prepared {split} hash mismatch")
        rows[split] = [strict_json(line) for line in path.read_text().splitlines() if line.strip()]
        if not rows[split] or len(rows[split]) != info["samples"]:
            raise ValueError(f"prepared {split} count mismatch")
    return manifest, rows


def padded_batch(examples: list[dict], pad_id: int) -> dict:
    """Pure Python so loss/padding masks can be tested without PyTorch."""
    length = max(len(row["input_ids"]) for row in examples)
    return {
        key: [row[key] + [fill] * (length - len(row[key])) for row in examples]
        for key, fill in (("input_ids", pad_id), ("attention_mask", 0), ("labels", -100))
    }


def run(args) -> dict:
    require_revision(args.revision)
    config = strict_json(args.config.read_text())
    manifest, splits = read_prepared(args.data, args.smoke)
    if args.output.exists():
        raise ValueError("output already exists; use a new run directory")
    if args.max_steps is not None and args.max_steps <= 0:
        raise ValueError("max-steps must be positive")
    if args.smoke:
        if args.max_steps is None:
            raise ValueError("smoke run requires explicit --max-steps")
        # prepare --smoke interleaves categories for a balanced small training probe.
        splits["train"] = splits["train"][:args.smoke_samples]
        if args.smoke_samples < 1:
            raise ValueError("smoke-samples must be positive")
    import torch
    from peft import LoraConfig, get_peft_model
    from transformers import AutoModelForCausalLM, AutoTokenizer, Trainer, TrainingArguments, set_seed

    if not torch.cuda.is_available():
        raise ValueError("training requires the NVIDIA machine; no CUDA device detected")
    set_seed(config["seed"])
    tokenizer = AutoTokenizer.from_pretrained(config["model_id"], revision=args.revision)
    if tokenizer.pad_token_id is None:
        tokenizer.pad_token = tokenizer.eos_token
    tokenizer.padding_side = "right"
    tokenized = {name: [tokenize_example(tokenizer, row["prompt"], row["completion"],
                                       config["max_length"]) for row in rows]
                 for name, rows in splits.items()}
    audit = []
    for row in tokenized["train"][:5]:
        active = [token for token, label in zip(row["input_ids"], row["labels"]) if label != -100]
        audit.append({"input_ids": row["input_ids"], "labels": row["labels"],
                      "supervised_text": tokenizer.decode(active), "tokens": len(row["input_ids"])})
    bf16 = torch.cuda.is_bf16_supported()
    dtype = torch.bfloat16 if bf16 else torch.float16
    model = AutoModelForCausalLM.from_pretrained(config["model_id"], revision=args.revision,
                                                torch_dtype=dtype, attn_implementation="sdpa")
    model.config.use_cache = False
    model = get_peft_model(model, LoraConfig(task_type="CAUSAL_LM", bias="none",
                          r=config["lora_rank"], lora_alpha=config["lora_alpha"],
                          lora_dropout=config["lora_dropout"], target_modules=config["target_modules"]))
    trainable = [(name, p.numel()) for name, p in model.named_parameters() if p.requires_grad]
    if not trainable or any("lora_" not in name for name, _ in trainable):
        raise ValueError("unexpected trainable parameters; expected LoRA only")
    def collate(examples):
        return {key: torch.tensor(value, dtype=torch.long)
                for key, value in padded_batch(examples, tokenizer.pad_token_id).items()}
    args.output.mkdir(parents=True)
    try:
        commit = subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip()
        dirty = bool(subprocess.check_output(["git", "status", "--porcelain"], text=True).strip())
    except (OSError, subprocess.CalledProcessError):
        commit, dirty = None, None
    record = {"model_id": config["model_id"], "revision": args.revision,
              "prompt_version": PROMPT_VERSION, "prompt_sha256": prompt_hash(), "config": config,
              "versions": versions(), "git_commit": commit, "git_dirty": dirty,
              "code_sha256": {p.name: file_hash(p) for p in sorted(Path(__file__).parent.glob("*.py"))},
              "purpose": manifest["purpose"], "prepared_manifest": manifest,
              "actual_samples": {k: len(v) for k, v in tokenized.items()},
              "actual_members": {k: manifest["members"][k][:len(v)] for k, v in tokenized.items()},
              "trainable_parameters": sum(n for _, n in trainable),
              "total_parameters": sum(p.numel() for p in model.parameters()),
              "device": torch.cuda.get_device_name(0), "dtype": str(dtype),
              "max_steps": args.max_steps, "status": "started"}
    def save_record():
        (args.output / "run.json").write_text(json.dumps(record, ensure_ascii=False, indent=2) + "\n")
    save_record()
    (args.output / "mask-audit.json").write_text(json.dumps(audit, ensure_ascii=False, indent=2) + "\n")
    try:
        trainer = Trainer(model=model, processing_class=tokenizer, data_collator=collate,
            train_dataset=tokenized["train"], eval_dataset=tokenized.get("validation"),
            args=TrainingArguments(output_dir=str(args.output / "checkpoints"),
                per_device_train_batch_size=config["micro_batch"], per_device_eval_batch_size=1,
                gradient_accumulation_steps=config["gradient_accumulation_steps"],
                learning_rate=config["learning_rate"], num_train_epochs=config["epochs"],
                max_steps=args.max_steps if args.max_steps is not None else -1,
                bf16=bf16, fp16=not bf16, gradient_checkpointing=True,
                gradient_checkpointing_kwargs={"use_reentrant": False},
                eval_strategy="no" if args.smoke else "epoch", save_strategy="epoch",
                save_total_limit=3, logging_steps=1 if args.smoke else 10, report_to=[],
                seed=config["seed"], data_seed=config["seed"], optim="adamw_torch",
                warmup_ratio=0.05, remove_unused_columns=False))
        torch.cuda.reset_peak_memory_stats()
        started = time.perf_counter()
        result = trainer.train()
        torch.cuda.synchronize()
        record.update(status="complete", elapsed_seconds=time.perf_counter() - started,
                      peak_allocated_bytes=torch.cuda.max_memory_allocated(),
                      peak_reserved_bytes=torch.cuda.max_memory_reserved(), train_metrics=result.metrics)
        model.save_pretrained(args.output, safe_serialization=True)
        tokenizer.save_pretrained(args.output)
        trainer.save_state()
        # Make epoch checkpoints evaluable with the same provenance checks as the final adapter.
        for checkpoint in (args.output / "checkpoints").glob("checkpoint-*"):
            if (checkpoint / "adapter_config.json").exists():
                checkpoint_record = {**record, "checkpoint": checkpoint.name,
                                     "note": "Evaluate on validation before selecting; not automatically best."}
                checkpoint_record.pop("train_metrics", None)
                (checkpoint / "run.json").write_text(json.dumps(checkpoint_record, ensure_ascii=False, indent=2) + "\n")
    except Exception as exc:
        record.update(status="failed", error=f"{type(exc).__name__}: {exc}")
        save_record()
        raise
    save_record()
    return record


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Completion-only LoRA training on a CUDA GPU")
    parser.add_argument("--data", type=Path, required=True)
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--revision", required=True, help="full base model commit SHA")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--smoke", action="store_true")
    parser.add_argument("--smoke-samples", type=int, default=16)
    parser.add_argument("--max-steps", type=int)
    args = parser.parse_args(argv)
    try:
        print(json.dumps(run(args), ensure_ascii=False, indent=2))
    except (ValueError, ImportError, OSError) as exc:
        parser.error(str(exc))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

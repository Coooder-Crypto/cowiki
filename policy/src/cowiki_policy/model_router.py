"""Optional GPU inference backend. It proposes routes and never executes tools."""
from __future__ import annotations

import hashlib
import importlib.metadata
import json
import re
from pathlib import Path

from .experiment import file_hash
from .prompts import PROMPT_VERSION, SYSTEM_PROMPT, messages


def require_revision(revision: str) -> None:
    if not re.fullmatch(r"[0-9a-f]{40}", revision):
        raise ValueError("use a full 40-character model commit SHA, not a moving branch/tag")


def versions() -> dict[str, str]:
    result = {}
    for name in ("torch", "transformers", "peft", "accelerate"):
        try:
            result[name] = importlib.metadata.version(name)
        except importlib.metadata.PackageNotFoundError:
            result[name] = "not installed"
    return result


def prompt_hash() -> str:
    return hashlib.sha256(SYSTEM_PROMPT.encode()).hexdigest()


class ModelRouter:
    def __init__(self, model_id: str, revision: str, adapter: Path | None = None,
                 max_input_tokens: int = 2048, max_new_tokens: int = 256):
        require_revision(revision)
        if max_input_tokens < 1 or max_new_tokens < 1:
            raise ValueError("token limits must be positive")
        import torch
        from transformers import AutoModelForCausalLM, AutoTokenizer

        if not torch.cuda.is_available():
            raise ValueError("model backend currently requires CUDA; dependency-free rule evaluation remains available")
        self.torch = torch
        self.max_input_tokens = max_input_tokens
        self.max_new_tokens = max_new_tokens
        dtype = torch.bfloat16 if torch.cuda.is_bf16_supported() else torch.float16
        if adapter:
            manifest = json.loads((adapter / "run.json").read_text())
            if (manifest["model_id"], manifest["revision"], manifest["prompt_sha256"]) != (
                    model_id, revision, prompt_hash()):
                raise ValueError("adapter base revision or prompt does not match this evaluation")
        self.tokenizer = AutoTokenizer.from_pretrained(model_id, revision=revision)
        self.model = AutoModelForCausalLM.from_pretrained(model_id, revision=revision,
                                                         torch_dtype=dtype, attn_implementation="sdpa")
        if adapter:
            from peft import PeftModel
            self.model = PeftModel.from_pretrained(self.model, str(adapter))
        self.model.to("cuda").eval()
        self.metadata = {"model_id": model_id, "revision": revision,
                         "adapter": str(adapter) if adapter else None,
                         "adapter_sha256": file_hash(adapter / "adapter_model.safetensors") if adapter else None,
                         "prompt_version": PROMPT_VERSION, "prompt_sha256": prompt_hash(),
                         "versions": versions(), "device": torch.cuda.get_device_name(0),
                         "dtype": str(dtype), "max_input_tokens": max_input_tokens,
                         "max_new_tokens": max_new_tokens, "decoding": "greedy; no grammar; no repair; no fallback"}

    def predict(self, value) -> str:
        torch = self.torch
        batch = self.tokenizer.apply_chat_template(messages(value), tokenize=True,
                    add_generation_prompt=True, return_dict=True, return_tensors="pt")
        if batch["input_ids"].shape[1] > self.max_input_tokens:
            raise ValueError("input exceeds token limit; no silent truncation")
        batch = {key: tensor.to("cuda") for key, tensor in batch.items()}
        with torch.inference_mode():
            generated = self.model.generate(**batch, do_sample=False, num_beams=1,
                max_new_tokens=self.max_new_tokens, pad_token_id=self.tokenizer.eos_token_id,
                eos_token_id=self.tokenizer.eos_token_id)
        text = self.tokenizer.decode(generated[0, batch["input_ids"].shape[1]:], skip_special_tokens=True)
        torch.cuda.synchronize()
        return text

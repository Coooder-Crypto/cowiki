from __future__ import annotations

import copy
import json
import tempfile
import unittest
from pathlib import Path

from cowiki_policy.evaluate import evaluate
from cowiki_policy.experiment import Prediction, canonical, constraint_errors, load_cases, strict_json
from cowiki_policy.lab import prepare
from cowiki_policy.model_router import require_revision
from cowiki_policy.prompts import messages, tokenize_example
from cowiki_policy.train import padded_batch, read_prepared

DATA = Path(__file__).resolve().parents[1] / "datasets/routing/dev.v1.jsonl"


class FakeTokenizer:
    """Character-token chat template, used only to test loss mask invariants."""
    def apply_chat_template(self, turns, tokenize=True, add_generation_prompt=False):
        text = "".join(f"<{t['role']}>" + t["content"] + "<end>" for t in turns)
        if add_generation_prompt:
            text += "<assistant>"
        return [ord(c) for c in text]


class ExperimentTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.cases = load_cases(DATA)
        cls.rows = [json.loads(line) for line in DATA.read_text().splitlines()]

    def check_invalid_dataset(self, rows, message):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "cases.jsonl"
            path.write_text("\n".join(json.dumps(r) for r in rows))
            with self.assertRaisesRegex(ValueError, message):
                load_cases(path)

    def test_development_data_is_not_claimed_as_human_reviewed_or_holdout(self):
        self.assertEqual(len(self.cases), 80)
        self.assertEqual(len({c.family_id for c in self.cases}), 40)
        self.assertEqual({c.split for c in self.cases}, {"dev"})
        self.assertEqual({c.review_status for c in self.cases}, {"pending"})

    def test_prompt_excludes_ids_gold_and_annotation(self):
        case = self.cases[0]
        prompt = messages(case.policy_input)
        user_input = json.loads(prompt[1]["content"])
        self.assertNotIn("task_id", user_input)
        self.assertEqual(set(user_input), set(case.policy_input.to_dict()) - {"task_id"})
        self.assertNotIn(case.family_id, canonical(prompt))
        self.assertNotIn(case.annotation_reason, canonical(prompt))

    def test_cross_split_family_is_rejected(self):
        rows = copy.deepcopy(self.rows[:2])
        rows[1]["split"] = "test"
        self.check_invalid_dataset(rows, "family crosses")

    def test_same_input_under_new_id_is_rejected(self):
        rows = [copy.deepcopy(self.rows[0]), copy.deepcopy(self.rows[0])]
        rows[1]["sample_id"] = rows[1]["input"]["task_id"] = "different_id"
        rows[1]["family_id"] = "different_family"
        self.check_invalid_dataset(rows, "duplicate model input")

    def test_gold_environment_violation_is_rejected(self):
        row = copy.deepcopy(next(r for r in self.rows if r["target"]["action"] and
                                 r["target"]["action"]["executor"] == "codex"))
        row["input"]["privacy"] = "sensitive"
        self.check_invalid_dataset([row], "invalid reference constraints")

    def test_malformed_outputs_count_as_failures_without_repair(self):
        cases = self.cases[:3]
        outputs = iter(["not json", '{"status":"blocked","action":{}}', canonical(cases[2].target.to_dict())])
        report, rows = evaluate(cases, lambda _: next(outputs))
        self.assertEqual(report["json_valid"]["count"], 2)
        self.assertEqual(report["schema_valid"]["count"], 1)
        self.assertEqual(report["acceptable_decision"], {"count": 1, "total": 3, "rate": 1/3})
        self.assertEqual(rows[0]["raw"], "not json")

    def test_inference_error_keeps_denominator(self):
        def broken(_):
            raise RuntimeError("simulated inference failure")
        summary, rows = evaluate(self.cases[:1], broken)
        self.assertEqual(summary["invalid_output"]["rate"], 1)
        self.assertIn("inference_error", rows[0]["error"])

    def test_over_refusal_is_not_safety_success(self):
        case = next(c for c in self.cases if c.target.status.value == "routed")
        summary, _ = evaluate([case], lambda _: '{"status":"blocked","action":null}')
        self.assertEqual(summary["normal_false_rejection"]["rate"], 1)
        self.assertEqual(summary["acceptable_decision"]["rate"], 0)

    def test_duplicate_json_keys_and_incoherent_approval_rejected(self):
        with self.assertRaisesRegex(ValueError, "duplicate"):
            strict_json('{"status":"routed","status":"blocked","action":null}')
        value = copy.deepcopy(self.cases[0].target.to_dict())
        value["status"] = "approval_required"
        with self.assertRaisesRegex(ValueError, "high risk"):
            Prediction.from_dict(value)

    def test_loss_masks_prompt_and_padding_but_supervises_completion(self):
        tokenizer = FakeTokenizer()
        prompt = [{"role": "user", "content": "question"}]
        row = tokenize_example(tokenizer, prompt, '{"answer":1}', 1000)
        count = len(tokenizer.apply_chat_template(prompt, add_generation_prompt=True))
        self.assertEqual(row["labels"][:count], [-100] * count)
        self.assertEqual(row["labels"][count:], row["input_ids"][count:])
        short = tokenize_example(tokenizer, prompt, "x", 1000)
        padded = padded_batch([row, short], 0)
        self.assertEqual(padded["labels"][1][-1], -100)
        self.assertEqual(padded["attention_mask"][1][-1], 0)
        with self.assertRaisesRegex(ValueError, "no silent truncation"):
            tokenize_example(tokenizer, prompt, "too long", 2)

    def test_template_prefix_mismatch_is_rejected(self):
        class BrokenTemplate(FakeTokenizer):
            def apply_chat_template(self, turns, **kwargs):
                tokens = super().apply_chat_template(turns, **kwargs)
                return tokens if kwargs.get("add_generation_prompt") else [0] + tokens
        with self.assertRaisesRegex(ValueError, "prefix differs"):
            tokenize_example(BrokenTemplate(), [{"role": "user", "content": "x"}], "y", 1000)

    def test_dev_export_requires_smoke_and_hashes_detect_mutation(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "prepared"
            with self.assertRaisesRegex(ValueError, "nonempty train"):
                prepare(DATA, output)
            manifest = prepare(DATA, output, smoke=True)
            self.assertEqual(manifest["purpose"], "smoke_only")
            first = manifest["members"]["train"][:8]
            by_id = {c.sample_id: c for c in self.cases}
            self.assertEqual(len({by_id[r["sample_id"]].category for r in first}), 8)
            read_prepared(output, smoke=True)
            with self.assertRaisesRegex(ValueError, "expected formal"):
                read_prepared(output, smoke=False)
            with (output / "train.jsonl").open("a") as handle:
                handle.write("{}\n")
            with self.assertRaisesRegex(ValueError, "hash mismatch"):
                read_prepared(output, smoke=True)

    def test_model_revision_must_be_immutable(self):
        with self.assertRaisesRegex(ValueError, "commit SHA"):
            require_revision("main")
        require_revision("a" * 40)

    def test_formal_export_requires_review_and_excludes_test(self):
        rows = [copy.deepcopy(self.rows[i]) for i in (0, 2, 4)]
        for row, split in zip(rows, ("train", "validation", "test")):
            row["split"] = split
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "source.jsonl"
            output = Path(directory) / "prepared"
            source.write_text("\n".join(json.dumps(r) for r in rows))
            with self.assertRaisesRegex(ValueError, "human-approved"):
                prepare(source, output)
            for row in rows:
                row["review_status"] = "approved"
            source.write_text("\n".join(json.dumps(r) for r in rows))
            prepare(source, output)
            manifest, splits = read_prepared(output, smoke=False)
            self.assertEqual(set(splits), {"train", "validation"})
            self.assertEqual(manifest["purpose"], "formal")
            self.assertFalse((output / "test.jsonl").exists())


if __name__ == "__main__":
    unittest.main()

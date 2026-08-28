# Voice Eval Baseline

This folder stores baseline voice-parsing cases for the kirana billing flow.

Purpose:
- create a small regression set before changing the speech pipeline
- compare current behavior against future transcription/parsing upgrades
- capture realistic Hindi, English, and mixed kirana speech patterns

File:
- `voice-cases.json`: utterances with expected transcript and expected parsed bill items

Notes:
- This is an evaluation set, not the product database.
- It is intentionally small to start; we can expand it with real shop usage.
- Unknown or ambiguous product cases are included on purpose so future phases can test review and confirmation flows.

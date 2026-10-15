import json
import os
import re
import sys
import time
import traceback
from pathlib import Path
from contextlib import redirect_stdout

PROTOCOL = sys.stdout


def emit(event):
    PROTOCOL.write(json.dumps(event, ensure_ascii=False) + "\n")
    PROTOCOL.flush()


def split_text(text, limit=220):
    words = re.findall(r"\S+", text)
    chunks = []
    current = ""
    for word in words:
        # También limita entradas sin espacios.
        for offset in range(0, len(word), limit):
            piece = word[offset:offset + limit]
            if current and len(current) + len(piece) + 1 > limit:
                chunks.append(current)
                current = ""
            current = (current + " " + piece).strip()
            if len(current) >= 60 and re.search(r"[.!?…]$", current):
                chunks.append(current)
                current = ""
    if current:
        chunks.append(current)
    return chunks


def main():
    with redirect_stdout(sys.stderr):
        import torch
        import soundfile as sf
        import perth
        if perth.PerthImplicitWatermarker is None:
            perth.PerthImplicitWatermarker = perth.DummyWatermarker
        from chatterbox.mtl_tts import ChatterboxMultilingualTTS
        requested = os.environ.get("STUDIO_DEVICE", "cpu")
        if requested == "cuda" and not torch.cuda.is_available():
            raise RuntimeError("No se detectó CUDA. Instala el motor NVIDIA y actualiza el controlador, o usa CPU.")
        device = "cuda" if requested == "cuda" else "cpu"
        torch.set_num_threads(4 if device == "cpu" else 2)
        model = ChatterboxMultilingualTTS.from_pretrained(device=device)
    emit({"type": "ready", "device": device, "model": "Chatterbox Multilingual", "sample_rate": model.sr})
    last_reference = None
    for line in sys.stdin:
        request = {}
        try:
            request = json.loads(line)
            text = str(request["text"]).strip()
            if not text or len(text) > 5000:
                raise ValueError("Escribe entre 1 y 5000 caracteres.")
            reference = str(Path(request["reference"]).resolve(strict=True))
            output = Path(request["out"])
            started = time.monotonic()
            chunks = split_text(text)
            exaggeration = max(0.25, min(0.95, float(request.get("expression", 0.6))))
            with redirect_stdout(sys.stderr), torch.inference_mode():
                if reference != last_reference:
                    model.prepare_conditionals(reference, exaggeration=exaggeration)
                    last_reference = reference
                audio = []
                for index, chunk in enumerate(chunks):
                    emit({"type": "progress", "id": request["id"], "current": index + 1, "total": len(chunks)})
                    wav = model.generate(chunk, request.get("language", "es"), exaggeration=exaggeration,
                                         cfg_weight=0.5, temperature=0.8, repetition_penalty=1.8,
                                         min_p=0.05, top_p=0.95)
                    if not torch.isfinite(wav).all():
                        raise RuntimeError("El modelo produjo audio inválido. Intenta generar nuevamente.")
                    if index:
                        audio.append(torch.zeros(1, int(model.sr * 0.13)))
                    audio.append(wav.cpu())
                combined = torch.cat(audio, dim=-1).squeeze().numpy()
                sf.write(str(output), combined, model.sr, subtype="PCM_16")
            emit({"type": "done", "id": request["id"], "out": str(output), "seconds": len(combined) / model.sr,
                  "elapsed_ms": round((time.monotonic() - started) * 1000)})
        except Exception as error:
            traceback.print_exc(file=sys.stderr)
            emit({"type": "error", "id": request.get("id"), "error": str(error)})


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        traceback.print_exc(file=sys.stderr)
        emit({"type": "fatal", "error": str(error)})
        sys.exit(1)

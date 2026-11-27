"""Trợ lý chat trên trang Nhập dữ liệu.

Người dùng mô tả bối cảnh thí nghiệm và dán / gõ số liệu bằng lời. Trợ lý đọc,
hỏi lại chỗ thiếu, và trả về các dòng dữ liệu đúng cột của template (Cuc,
QuetNhiet, EpBac, LapDat, KiemChung). Trợ lý KHÔNG tự lưu: các dòng được đổ vào
form, qua bước kiểm tra, người dùng bấm Lưu.

Hai loại model, chọn bằng biến môi trường:
  AI_CHAT_PROVIDER=ollama  model nhỏ chạy ngay trên server, không cần Internet.
      OLLAMA_URL   (mặc định http://ollama:11434), OLLAMA_MODEL (mặc định qwen2.5:7b)
  AI_CHAT_PROVIDER=claude  gọi Claude API, cần ANTHROPIC_API_KEY.
      CLAUDE_MODEL (mặc định claude-haiku-5-5)
  AI_CHAT_PROVIDER=openai  (mặc định) mọi dịch vụ có API kiểu OpenAI, gồm cả bản miễn phí:
      Google Gemini (AI Studio), Groq, OpenRouter...
      LLM_BASE_URL, LLM_API_KEY, LLM_MODEL
      Gemini: LLM_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai  LLM_MODEL=gemini-3.5-flash-lite
      Groq:   LLM_BASE_URL=https://api.groq.com/openai/v1                           LLM_MODEL=llama-3.3-70b-versatile
"""
from __future__ import annotations

import asyncio
import json
import os
from datetime import datetime

import httpx

from . import dataset

PROVIDER = os.getenv("AI_CHAT_PROVIDER", "openai").lower()
OLLAMA_URL = os.getenv("OLLAMA_URL", "http://ollama:11434").rstrip("/")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "qwen2.5:7b")
CLAUDE_MODEL = os.getenv("CLAUDE_MODEL", "claude-haiku-5-5")
LLM_BASE_URL = os.getenv("LLM_BASE_URL", "https://generativelanguage.googleapis.com/v1beta/openai").rstrip("/")
LLM_API_KEY = os.getenv("LLM_API_KEY", "")
LLM_MODEL = os.getenv("LLM_MODEL", "gemini-3.5-flash-lite")
TIMEOUT = float(os.getenv("AI_CHAT_TIMEOUT_S", "180"))

# Mọi cột có thể xuất hiện ở một dòng (gộp 5 sheet). Cột không dùng thì null.
NUM = {"anyOf": [{"type": "number"}, {"type": "null"}]}
STR = {"anyOf": [{"type": "string"}, {"type": "null"}]}
ROW_FIELDS = {
    "ma_cuc": STR, "thoi_diem": STR, "nhiet_do_c": NUM, "do_am_pct": NUM,
    "rho_ohm_m": NUM, "rs_ohm": NUM, "rho_std": NUM, "so_mau": NUM,
    "chu_ky": NUM, "tai_kn": NUM, "ung_suat_mpa": NUM,
    "rho0_ohm_m": NUM, "rho_doi_chung_ohm_m": NUM, "ung_suat_that_mpa": NUM,
    "cap_phoi": STR, "me_duc": STR, "ngay_duc": STR, "cuong_do_nen_mpa": NUM,
    "dien_tich_dien_cuc_mm2": NUM, "khoang_cach_dien_cuc_mm": NUM, "dien_tich_chiu_nen_mm2": NUM,
    "la_cuc_doi_chung": {"anyOf": [{"type": "boolean"}, {"type": "null"}]},
    "ma_cuc_doi_chung": STR, "vi_tri": STR, "ghi_chu": STR,
}
SCHEMA = {
    "type": "object",
    "properties": {
        "reply": {"type": "string"},
        "sheet": {"type": "string", "enum": ["", *dataset.SHEETS.keys()]},
        "info": {
            "type": "object",
            "properties": {"ma_cuc": STR, "ngay": STR, "nguoi": STR, "nhiet_do_c": NUM, "do_am_pct": NUM, "ghi_chu": STR},
            "required": ["ma_cuc", "ngay", "nguoi", "nhiet_do_c", "do_am_pct", "ghi_chu"],
            "additionalProperties": False,
        },
        "rows": {"type": "array", "items": {
            "type": "object", "properties": ROW_FIELDS,
            "required": list(ROW_FIELDS), "additionalProperties": False}},
        "questions": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["reply", "sheet", "info", "rows", "questions"],
    "additionalProperties": False,
}


def _sheet_doc() -> str:
    out = []
    for name, cols in dataset.SHEETS.items():
        out.append(f"### {name}")
        out += [f"- {k}{' (bắt buộc)' if req else ''}: {d}" for k, d, req in cols]
        guide = dict(dataset.GUIDE).get(name)
        if guide:
            out.append(f"Quy trình: {guide}")
    return "\n".join(out)


SYSTEM = f"""Bạn là trợ lý nhập dữ liệu thí nghiệm cho dự án bê tông tự cảm biến (SSC).
Người dùng là kỹ sư, viết tiếng Việt. Họ mô tả bối cảnh thí nghiệm và đưa số liệu bằng lời,
bảng dán, hoặc ghi chép. Việc của bạn: chuyển thành các dòng dữ liệu đúng cột của MỘT sheet dưới đây.

Các sheet và cột:
{_sheet_doc()}

Quy tắc:
1. Chỉ dùng con số người dùng đưa ra. KHÔNG bịa, không nội suy, không làm tròn khác đi. Thiếu số thì để null và hỏi lại trong "questions".
2. Đổi đơn vị khi cần: MPa = kN * 1000 / diện tích chịu nén (mm²); kΩ -> Ω (x1000); ρ (Ω·m) = Rs (Ω) * A (mm²) * 1e-6 / (L (mm) * 1e-3).
   Nếu người dùng chỉ cho Rs thì điền rs_ohm, để rho_ohm_m null (form sẽ tự tính). Nếu cho ứng suất MPa thay vì kN, đổi sang tai_kn bằng diện tích chịu nén của cục.
3. Chọn sheet theo bối cảnh: tủ nhiệt không tải -> QuetNhiet; máy nén theo bậc -> EpBac; đặt vào công trình chưa tải -> LapDat;
   tải biết trước ngoài hiện trường -> KiemChung; khai báo cục mới -> Cuc. Chưa đủ để biết thì sheet = "" và hỏi.
4. EpBac: mỗi chu kỳ phải bắt đầu bằng bậc 0 kN; đánh chu_ky 1, 2, 3 theo thứ tự người dùng kể.
   Nhiệt độ chung cho cả lần đo thì đặt ở info.nhiet_do_c và cũng điền vào từng dòng.
5. info: mã cục (phải là một mã trong danh sách cục bên dưới, trừ khi đang khai báo cục mới), ngày (yyyy-mm-dd), người đo, nhiệt độ, độ ẩm, ghi chú ngắn tóm tắt bối cảnh.
6. thoi_diem dạng yyyy-mm-ddThh:mm nếu biết giờ, không thì yyyy-mm-dd.
7. Mọi chuỗi (reply, ghi_chu, questions) viết tiếng Việt CÓ ĐỦ DẤU. "reply": 1-3 câu, nói đã hiểu gì và điền được bao nhiêu dòng, nhắc điểm bất thường (ví dụ ρ tăng khi nén, ứng suất quá 20% fc).
8. Mỗi lần trả lời, "rows" là TOÀN BỘ các dòng của sheet đang làm (không chỉ phần mới), để form thay thế bằng danh sách này.
"""


def _context_block(context: str, blocks: list[dict], form: dict) -> str:
    cuc = "\n".join(
        f"- {b['code']}: cấp phối {b.get('mix')}, A={b.get('electrode_area_mm2')} mm², L={b.get('electrode_gap_mm')} mm, "
        f"diện tích chịu nén {b.get('load_area_mm2')} mm², fc={b.get('fc_mpa')} MPa"
        f"{', cục đối chứng' if b.get('is_reference') else ''}" for b in blocks) or "(chưa có cục nào)"
    return (f"Hôm nay: {datetime.now():%Y-%m-%d}\n\nCác cục đã có trên server:\n{cuc}\n\n"
            f"Trạng thái form hiện tại (JSON): {json.dumps(form, ensure_ascii=False)[:4000]}\n\n"
            f"Bối cảnh thí nghiệm người dùng mô tả:\n{context.strip() or '(chưa mô tả)'}")


async def _ollama(system: str, messages: list[dict]) -> str:
    async with httpx.AsyncClient(timeout=TIMEOUT) as c:
        r = await c.post(f"{OLLAMA_URL}/api/chat", json={
            "model": OLLAMA_MODEL, "stream": False, "format": SCHEMA,
            "options": {"temperature": 0},
            "messages": [{"role": "system", "content": system}, *messages],
        })
        r.raise_for_status()
        return r.json()["message"]["content"]


async def _openai_compat(system: str, messages: list[dict]) -> str:
    """API kiểu OpenAI (Gemini, Groq, OpenRouter...). Thử JSON schema chặt, dịch vụ nào không hỗ trợ thì lùi về JSON thường."""
    body = {"model": LLM_MODEL, "temperature": 0,
            "messages": [{"role": "system", "content": system}, *messages]}
    fmt_strict = {"type": "json_schema", "json_schema": {"name": "du_lieu", "strict": True, "schema": SCHEMA}}
    fmt_loose = {"type": "json_object"}
    loose_hint = ("\n\nTrả lời DUY NHẤT một object JSON theo đúng schema sau, không thêm chữ nào khác:\n"
                  + json.dumps(SCHEMA, ensure_ascii=False))
    async with httpx.AsyncClient(timeout=TIMEOUT, headers={"Authorization": f"Bearer {LLM_API_KEY}"}) as c:
        r = await c.post(f"{LLM_BASE_URL}/chat/completions", json={**body, "response_format": fmt_strict})
        if r.status_code == 400:
            body["messages"][0]["content"] += loose_hint
            r = await c.post(f"{LLM_BASE_URL}/chat/completions", json={**body, "response_format": fmt_loose})
        if r.status_code == 429:
            raise RuntimeError("hết hạn mức miễn phí, thử lại sau ít phút")
        r.raise_for_status()
        text = r.json()["choices"][0]["message"]["content"] or ""
    text = text.strip()
    if text.startswith("```"):
        text = text.strip("`").removeprefix("json").strip()
    return text


def _fill(d: dict) -> dict:
    """Chế độ JSON thường có thể thiếu khoá: bổ sung cho đủ."""
    d.setdefault("reply", ""); d.setdefault("sheet", ""); d.setdefault("questions", [])
    d["info"] = d.get("info") or {}
    d["rows"] = [r for r in (d.get("rows") or []) if isinstance(r, dict)]
    if d["sheet"] not in ("", *dataset.SHEETS):
        d["sheet"] = ""
    return d


def _claude_sync(system: str, messages: list[dict]) -> str:
    import anthropic

    client = anthropic.Anthropic()
    resp = client.messages.create(
        model=CLAUDE_MODEL, max_tokens=16000, system=system, messages=messages,
        output_config={"effort": "low", "format": {"type": "json_schema", "schema": SCHEMA}},
    )
    if resp.stop_reason == "refusal":
        raise RuntimeError("Model từ chối yêu cầu này.")
    if resp.stop_reason == "max_tokens":
        raise RuntimeError("Câu trả lời quá dài, hãy chia số liệu thành vài lần.")
    return next(b.text for b in resp.content if b.type == "text")


async def chat(context: str, history: list[dict], blocks: list[dict], form: dict) -> dict:
    """history: [{role: user|assistant, content: str}], tin cuối là của người dùng."""
    system = SYSTEM + "\n\n" + _context_block(context, blocks, form)
    msgs = [{"role": m["role"], "content": str(m["content"])} for m in history[-20:] if m.get("content")]
    if PROVIDER == "claude":
        text = await asyncio.to_thread(_claude_sync, system, msgs)
    elif PROVIDER == "openai":
        text = await _openai_compat(system, msgs)
    else:
        text = await _ollama(system, msgs)
    data = _fill(json.loads(text))
    # bỏ cột null cho gọn, giữ đúng tên cột template
    data["rows"] = [{k: v for k, v in r.items() if v is not None} for r in data.get("rows", [])]
    data["info"] = {k: v for k, v in (data.get("info") or {}).items() if v is not None}
    data["model"] = _model()
    return data


def _model() -> str:
    return {"claude": CLAUDE_MODEL, "openai": LLM_MODEL}.get(PROVIDER, OLLAMA_MODEL)


def status() -> dict:
    url = {"openai": LLM_BASE_URL, "claude": None}.get(PROVIDER, OLLAMA_URL)
    return {"provider": PROVIDER, "model": _model(), "url": url}

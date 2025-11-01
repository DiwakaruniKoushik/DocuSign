# ai_processor.py
import os, json, re, traceback
from typing import List, Dict, Any, Optional
from openai import OpenAI

SYSTEM = (
    "You generate clear guidance for users filling form fields in three formats: "
    "1) MICRO: A 3-5 word concise label/description "
    "2) LONG: A 3-5 sentence detailed explanation "
    "3) DEMO: A realistic example value that could be used as sample data "
    "Be concise, concrete, and actionable. Avoid legalese and fluff. "
    "Use the per-field local context and the optional label_guess to tailor the advice. "
    "Always respond with STRICT JSON only."
)

def trim(text: str, max_chars: int = 900) -> str:
    if not text: return ""
    if len(text) <= max_chars: return text
    head, tail = text[:max_chars//2], text[-max_chars//2:]
    return head + " … " + tail

def _format_prompt(filename: str, placeholders: List[Dict[str, Any]]) -> str:
    MAX_FIELDS = 120
    phs = placeholders[:MAX_FIELDS]
    
    lines = []
    for i, p in enumerate(phs, 1):
        key_text = p["value"] if p["type"] == "bracketed" else f'{p["label"]}:'
        lines.append(
            f'{i}. id="{p["id"]}" | key="{key_text}" | line={p["line"]} | label_guess="{p.get("label_guess","")}"\n'
            f'   context: {trim(p.get("context",""))}'
        )

    schema_hint = (
        "{\n"
        '  "id1": {\n'
        '    "micro": "3-5 words",\n'
        '    "long": "3-5 sentences explaining what to enter...",\n'
        '    "demo": "realistic example value"\n'
        '  },\n'
        '  "id2": {\n'
        '    "micro": "3-5 words",\n'
        '    "long": "3-5 sentences explaining what to enter...",\n'
        '    "demo": "realistic example value"\n'
        '  },\n'
        "  ...\n"
        "}"
    )

    prompt = f"""
Document: {filename}

For each FIELD below, provide THREE types of guidance:
1. MICRO: A concise 3-5 word label/description (e.g., "Company legal name", "Investment amount", "Founder signature")
2. LONG: A detailed 3-5 sentence explanation guiding the user on WHAT to enter and WHY
3. DEMO: A realistic example value that could be used as sample/demo data (e.g., "Acme Corporation LLC", "$500,000", "John Smith")

Use the local context and the label_guess to distinguish similarly named blanks.
Return STRICT JSON mapping from field id -> object with "micro", "long", and "demo" keys (no code fences, no prose).

FIELDS:
{chr(10).join(lines)}

Return JSON exactly like:
{schema_hint}
""".strip()
    
    return prompt

def _extract_json(text: str) -> Optional[Dict[str, Any]]:
    if not text:
        return None
    
    t = text.strip()
    
    if t.startswith("```"):
        t = re.sub(r"^```(?:json)?\s*|\s*```$", "", t, flags=re.IGNORECASE)
    
    s, e = t.find("{"), t.rfind("}")
    if s != -1 and e != -1 and e > s:
        try:
            json_str = t[s:e+1]
            result = json.loads(json_str)
            return result
        except Exception:
            return None
    
    return None

def _call_model(client: OpenAI, prompt: str) -> Dict[str, Any]:
    # Try Responses API with enforced JSON
    try:
        r = client.responses.create(
            model="gpt-5-mini",
            input=prompt,
            max_output_tokens=6000,
        )
        
        raw = (r.output_text or "").strip() if hasattr(r, 'output_text') else ""
        if not raw and hasattr(r, 'output'):
            raw = str(r.output).strip()
        if not raw:
            for attr in ['text', 'content', 'response', 'result']:
                if hasattr(r, attr):
                    raw = str(getattr(r, attr)).strip()
                    if raw:
                        break
        
        if raw:
            try:
                parsed = json.loads(raw)
                return parsed
            except json.JSONDecodeError:
                try:
                    if not raw.rstrip().endswith('}'):
                        last_comma = raw.rfind(',')
                        if last_comma > 0:
                            fixed = raw[:last_comma] + "\n}"
                            parsed = json.loads(fixed)
                            return parsed
                except Exception:
                    pass
        
        alt = _extract_json(getattr(r, "output", "") or "")
        if alt:
            return alt
    except Exception:
        pass

    # Fallback: chat.completions
    try:
        r = client.chat.completions.create(
            model="gpt-5-mini",
            messages=[
                {"role":"system","content":SYSTEM},
                {"role":"user","content": prompt + "\n\nReturn ONLY JSON (id->object with micro and long)."}
            ],
            temperature=0.4,
            max_completion_tokens=6000,
            response_format={"type": "json_object"}
        )
        
        raw = ""
        if r.choices[0].message.content:
            raw = r.choices[0].message.content.strip()
        elif hasattr(r.choices[0].message, 'reasoning_content') and r.choices[0].message.reasoning_content:
            raw = str(r.choices[0].message.reasoning_content).strip()
        
        data = _extract_json(raw)
        if data:
            return data
    except Exception:
        pass

    return {}

def generate_field_guidance(filename: str, placeholders: List[Dict[str, Any]], pdf_path: Optional[str]=None) -> Dict[str, Dict[str, str]]:
    """
    Generate both micro and long guidance for each field.
    Returns: Dict[field_id, {"micro": "...", "long": "...", "demo": "..."}]
    """
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        return {}

    client = OpenAI(api_key=api_key)
    prompt = _format_prompt(filename, placeholders)
    data = _call_model(client, prompt)

    # Map the response to placeholder IDs
    guidance_by_id: Dict[str, Dict[str, str]] = {}
    
    # First try: direct ID lookup
    for p in placeholders:
        g = data.get(p["id"])
        if isinstance(g, dict) and "micro" in g and "long" in g:
            guidance_by_id[p["id"]] = {
                "micro": g["micro"].strip(),
                "long": g["long"].strip(),
                "demo": g.get("demo", "").strip()
            }
    
    # Second try: if no matches, assume model returned numeric keys
    if not guidance_by_id:
        for i, p in enumerate(placeholders[:120], 1):
            g = data.get(str(i))
            if isinstance(g, dict) and "micro" in g and "long" in g:
                guidance_by_id[p["id"]] = {
                    "micro": g["micro"].strip(),
                    "long": g["long"].strip(),
                    "demo": g.get("demo", "").strip()
                }
    
    return guidance_by_id
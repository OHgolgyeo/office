// 사용자가 만든 AI 글쓰기 도구. 설정과 API 키는 하나의 암호화 파일에 저장하고,
// 외부 요청은 Electron 메인 프로세스에서만 보낸다(편집 화면에는 키를 돌려주지 않는다).
import fs from "fs";
import path from "path";
import crypto from "crypto";

const PROVIDERS = new Set(["openai", "anthropic", "gemini", "compatible"]);
const DEFAULTS = {
  openai: { model: "gpt-5.6-luna", endpoint: "https://api.openai.com/v1/responses" },
  anthropic: { model: "claude-sonnet-4-6", endpoint: "https://api.anthropic.com/v1/messages" },
  gemini: { model: "gemini-3.8-flash", endpoint: "https://generativelanguage.googleapis.com/v1beta" },
  compatible: { model: "", endpoint: "" },
};
const text = (v, max) => String(v ?? "").trim().slice(0, max);
const validColor = (v) => /^#[0-9a-f]{6}$/i.test(String(v || "")) ? String(v) : "#6b7b3a";
const validUrl = (v) => {
  try { const u = new URL(String(v)); return u.protocol === "https:" || (u.protocol === "http:" && ["127.0.0.1", "localhost"].includes(u.hostname)); }
  catch { return false; }
};

function cleanTool(raw, old = null) {
  const provider = PROVIDERS.has(raw?.provider) ? raw.provider : "openai", d = DEFAULTS[provider];
  const endpoint = text(raw?.endpoint || d.endpoint, 1000);
  if (!validUrl(endpoint)) throw new Error("API 주소는 https 주소여야 합니다. 이 컴퓨터의 localhost 주소만 http를 사용할 수 있습니다.");
  const model = text(raw?.model || d.model, 200); if (!model) throw new Error("모델 이름을 입력해 주세요.");
  const name = text(raw?.name, 30); if (!name) throw new Error("버튼 이름을 입력해 주세요.");
  const key = text(raw?.apiKey, 1000) || old?.apiKey || ""; if (!key) throw new Error("API 키를 입력해 주세요.");
  return {
    id: old?.id || (text(raw?.id, 80) || crypto.randomUUID()), name, icon: text(raw?.icon, 4) || "AI",
    color: validColor(raw?.color), provider, endpoint, model, apiKey: key,
    prompt: text(raw?.prompt, 12000) || "다음 글을 자연스럽고 정확하게 다듬어 주세요. 결과 문장만 출력하세요.",
    view: raw?.view === "side" ? "side" : "float", side: raw?.side === "left" ? "left" : "right",
  };
}

async function jsonRequest(url, { headers, body }) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 120000);
  try {
    const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body), signal: controller.signal });
    const raw = await r.text(); let data;
    try { data = JSON.parse(raw); } catch { data = null; }
    if (!r.ok) throw new Error(data?.error?.message || data?.message || raw.slice(0, 500) || `HTTP ${r.status}`);
    return data;
  } catch (e) {
    if (e?.name === "AbortError") throw new Error("AI 응답을 2분 안에 받지 못했습니다.");
    throw e;
  } finally { clearTimeout(timer); }
}

function promptFor(tool, input) {
  return tool.prompt.includes("{{text}}") ? tool.prompt.replaceAll("{{text}}", input) : `${tool.prompt}\n\n[사용자 글]\n${input}`;
}

async function callProvider(tool, input) {
  const prompt = promptFor(tool, input); let data, output = "";
  if (tool.provider === "openai") {
    data = await jsonRequest(tool.endpoint, { headers: { authorization: `Bearer ${tool.apiKey}` }, body: { model: tool.model, input: prompt } });
    output = data?.output_text || (data?.output || []).flatMap((x) => x.content || []).filter((x) => x.type === "output_text").map((x) => x.text).join("");
  } else if (tool.provider === "anthropic") {
    data = await jsonRequest(tool.endpoint, { headers: { "x-api-key": tool.apiKey, "anthropic-version": "2023-06-01" }, body: { model: tool.model, max_tokens: 4096, messages: [{ role: "user", content: prompt }] } });
    output = (data?.content || []).filter((x) => x.type === "text").map((x) => x.text).join("");
  } else if (tool.provider === "gemini") {
    const base = tool.endpoint.replace(/\/$/, ""), model = encodeURIComponent(tool.model.replace(/^models\//, ""));
    data = await jsonRequest(`${base}/models/${model}:generateContent`, { headers: { "x-goog-api-key": tool.apiKey }, body: { contents: [{ role: "user", parts: [{ text: prompt }] }] } });
    output = (data?.candidates?.[0]?.content?.parts || []).map((x) => x.text || "").join("");
  } else {
    data = await jsonRequest(tool.endpoint, { headers: { authorization: `Bearer ${tool.apiKey}` }, body: { model: tool.model, messages: [{ role: "user", content: prompt }] } });
    const content = data?.choices?.[0]?.message?.content;
    output = typeof content === "string" ? content : Array.isArray(content) ? content.map((x) => x.text || "").join("") : "";
  }
  output = String(output || "").trim(); if (!output) throw new Error("AI가 글로 된 결과를 보내지 않았습니다.");
  return output;
}

export class AiTools {
  constructor({ dir, crypt }) { this.file = path.join(dir, "ai-tools.bin"); this.crypt = crypt; this.tools = this.load(); }
  load() {
    try { return JSON.parse(this.crypt.decrypt(fs.readFileSync(this.file))).map((x) => cleanTool(x, x)).slice(0, 20); }
    catch { return []; }
  }
  persist() { fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.writeFileSync(this.file, this.crypt.encrypt(JSON.stringify(this.tools))); }
  list() { return this.tools.map(({ apiKey, ...x }) => ({ ...x, hasKey: !!apiKey })); }
  save(raw) {
    const i = this.tools.findIndex((x) => x.id === raw?.id), old = i >= 0 ? this.tools[i] : null, tool = cleanTool(raw, old);
    if (i >= 0) this.tools[i] = tool; else { if (this.tools.length >= 20) throw new Error("AI 도구는 최대 20개까지 만들 수 있습니다."); this.tools.push(tool); }
    this.persist(); return this.list();
  }
  remove(id) { const n = this.tools.length; this.tools = this.tools.filter((x) => x.id !== id); if (this.tools.length === n) throw new Error("AI 도구를 찾지 못했습니다."); this.persist(); return this.list(); }
  async run(id, input) {
    const tool = this.tools.find((x) => x.id === id); if (!tool) throw new Error("AI 도구를 찾지 못했습니다.");
    const value = text(input, 200000); if (!value) throw new Error("AI에 보낼 글이 없습니다.");
    return { id, output: await callProvider(tool, value) };
  }
}

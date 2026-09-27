// 사용자가 만든 API 글쓰기 도구. 설정과 API 키는 하나의 암호화 파일에 저장하고,
// 외부 요청은 Electron 메인 프로세스에서만 보낸다(편집 화면에는 키를 돌려주지 않는다).
import fs from "fs";
import path from "path";
import crypto from "crypto";

const PROVIDERS = new Set(["openai", "anthropic", "gemini", "vertex", "google_cloud", "compatible", "custom"]);
const DEFAULTS = {
  openai: { model: "gpt-5.6-luna", endpoint: "https://api.openai.com/v1/responses" },
  anthropic: { model: "claude-sonnet-4-6", endpoint: "https://api.anthropic.com/v1/messages" },
  gemini: { model: "gemini-3.8-flash", endpoint: "https://generativelanguage.googleapis.com/v1beta" },
  // Vertex AI의 Gemini 호출과 일반 Google Cloud REST API는 서로 다른 종류다.
  vertex: { model: "", endpoint: "https://aiplatform.googleapis.com/v1" },
  google_cloud: { model: "", endpoint: "https://translation.googleapis.com/language/translate/v2" },
  compatible: { model: "", endpoint: "" },
  custom: { model: "", endpoint: "http://127.0.0.1:8000/" },
};
const text = (v, max) => String(v ?? "").trim().slice(0, max);
const validColor = (v) => /^#[0-9a-f]{6}$/i.test(String(v || "")) ? String(v) : "#6b7b3a";
const validUrl = (v) => {
  try { const u = new URL(String(v)); return u.protocol === "https:" || (u.protocol === "http:" && ["127.0.0.1", "localhost"].includes(u.hostname)); }
  catch { return false; }
};

function cleanTool(raw, old = null) {
  let provider = PROVIDERS.has(raw?.provider) ? raw.provider : "custom";
  const d = DEFAULTS[provider];
  let enteredEndpoint = text(raw?.endpoint, 1000);
  if (provider === "google_cloud" && /^https:\/\/aiplatform\.googleapis\.com\/v1\/?$/i.test(enteredEndpoint)) enteredEndpoint = "";
  const endpoint = enteredEndpoint || d.endpoint;
  if (!validUrl(endpoint)) throw new Error("API 주소는 https 주소여야 합니다. 이 컴퓨터의 localhost 주소만 http를 사용할 수 있습니다.");
  const model = text(raw?.model || d.model, 200); if (!model && !["custom", "google_cloud"].includes(provider)) throw new Error("모델 이름을 입력해 주세요.");
  const name = text(raw?.name, 30); if (!name) throw new Error("버튼 이름을 입력해 주세요.");
  const key = text(raw?.apiKey, 1000) || old?.apiKey || "";
  if (!key && !["compatible", "custom"].includes(provider)) throw new Error("API 키를 입력해 주세요.");
  const defaultCloudEndpoint = provider === "google_cloud" && (!enteredEndpoint || enteredEndpoint.replace(/\/$/, "") === d.endpoint.replace(/\/$/, ""));
  return {
    id: old?.id || (text(raw?.id, 80) || crypto.randomUUID()), name, icon: text(raw?.icon, 4) || "AI",
    color: validColor(raw?.color), provider, endpoint: defaultCloudEndpoint ? "" : endpoint, model, apiKey: key,
    prompt: text(raw?.prompt, 12000) || "다음 글을 자연스럽고 정확하게 다듬어 주세요. 결과 문장만 출력하세요.",
    designHtml: text(raw?.designHtml, 50000),
    requestJson: text(raw?.requestJson, 20000), resultPath: text(raw?.resultPath, 500),
    authHeader: text(raw?.authHeader, 200) || "Authorization", authPrefix: text(raw?.authPrefix, 100),
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
    return data ?? raw;
  } catch (e) {
    if (e?.name === "AbortError") throw new Error("API 응답을 2분 안에 받지 못했습니다.");
    throw e;
  } finally { clearTimeout(timer); }
}

function promptFor(tool, input, options = {}) {
  let prompt = tool.prompt.includes("{{text}}") || tool.prompt.includes("{{originalText}}") ? tool.prompt : `${tool.prompt}\n\n[사용자 글]\n${input}`;
  const values = { text: input, originalText: input, translatedText: options.translatedText ?? "", ...options };
  for (const [key, value] of Object.entries(values)) prompt = prompt.replaceAll(`{{${key}}}`, String(value ?? ""));
  return prompt;
}

function customBody(tool, prompt) {
  if (!tool.requestJson) return { input: prompt };
  let parsed;
  try { parsed = JSON.parse(tool.requestJson); } catch { throw new Error("요청 JSON 형식이 올바르지 않습니다."); }
  const replace = (value) => {
    if (typeof value === "string") return value.replaceAll("{{prompt}}", prompt).replaceAll("{{text}}", prompt);
    if (Array.isArray(value)) return value.map(replace);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, replace(v)]));
    return value;
  };
  return replace(parsed);
}

function resultAt(data, pathText) {
  if (pathText) {
    const value = pathText.split(".").filter(Boolean).reduce((v, key) => v?.[key], data);
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
    if (value != null) return JSON.stringify(value, null, 2);
    throw new Error(`응답에서 결과 위치 “${pathText}”을 찾지 못했습니다.`);
  }
  if (typeof data === "string" || typeof data === "number" || typeof data === "boolean") return String(data);
  const common = data?.output ?? data?.result ?? data?.text ?? data?.message ?? data?.data?.output ?? data?.data?.text;
  if (typeof common === "string" || typeof common === "number" || typeof common === "boolean") return String(common);
  return data == null ? "" : JSON.stringify(data, null, 2);
}

function decodeEntities(value) {
  return String(value || "").replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|#39);/gi, (m, code) => {
    const named = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'" };
    if (named[code.toLowerCase()]) return named[code.toLowerCase()];
    const n = code[1]?.toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
    return Number.isFinite(n) ? String.fromCodePoint(n) : m;
  });
}

async function callProvider(tool, input, options = {}) {
  const prompt = promptFor(tool, input, options); let data, output = "";
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
  } else if (tool.provider === "vertex") {
    const base = tool.endpoint.replace(/\/$/, ""), model = encodeURIComponent(tool.model.replace(/^publishers\/google\/models\//, ""));
    data = await jsonRequest(`${base}/publishers/google/models/${model}:generateContent`, { headers: { "x-goog-api-key": tool.apiKey }, body: { contents: [{ role: "user", parts: [{ text: prompt }] }] } });
    output = (data?.candidates?.[0]?.content?.parts || []).map((x) => x.text || "").join("");
  } else if (tool.provider === "google_cloud") {
    const source = ["ko", "en", "ja"].includes(options.sourceLanguage) ? options.sourceLanguage : "ko";
    const target = ["ko", "en", "ja"].includes(options.targetLanguage) ? options.targetLanguage : "en";
    if (source === target) output = input;
    else {
      data = await jsonRequest(tool.endpoint || DEFAULTS.google_cloud.endpoint, { headers: { "x-goog-api-key": tool.apiKey }, body: { q: input, source, target, format: "text" } });
      output = decodeEntities(data?.data?.translations?.[0]?.translatedText);
    }
  } else if (tool.provider === "compatible") {
    const headers = tool.apiKey ? { authorization: `Bearer ${tool.apiKey}` } : {};
    data = await jsonRequest(tool.endpoint, { headers, body: { model: tool.model, messages: [{ role: "user", content: prompt }] } });
    const content = data?.choices?.[0]?.message?.content;
    output = typeof content === "string" ? content : Array.isArray(content) ? content.map((x) => x.text || "").join("") : "";
  } else {
    const headers = {};
    if (tool.apiKey && tool.authHeader) headers[tool.authHeader] = `${tool.authPrefix}${tool.apiKey}`;
    data = await jsonRequest(tool.endpoint, { headers, body: customBody(tool, prompt) });
    output = resultAt(data, tool.resultPath);
  }
  output = String(output || "").trim(); if (!output) throw new Error("API가 표시할 결과를 보내지 않았습니다.");
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
    if (i >= 0) this.tools[i] = tool; else { if (this.tools.length >= 20) throw new Error("API 도구는 최대 20개까지 만들 수 있습니다."); this.tools.push(tool); }
    this.persist(); return this.list();
  }
  remove(id) { const n = this.tools.length; this.tools = this.tools.filter((x) => x.id !== id); if (this.tools.length === n) throw new Error("API 도구를 찾지 못했습니다."); this.persist(); return this.list(); }
  async run(id, input, options = {}) {
    const tool = this.tools.find((x) => x.id === id); if (!tool) throw new Error("API 도구를 찾지 못했습니다.");
    const value = text(input, 200000); if (!value) throw new Error("API에 보낼 내용이 없습니다.");
    return { id, output: await callProvider(tool, value, options) };
  }
}

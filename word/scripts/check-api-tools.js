import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { AiTools } from "../core/ai-tools.js";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ogolgye-api-check-"));
const crypt = { encrypt: (value) => Buffer.from(value), decrypt: (value) => Buffer.from(value).toString("utf8") };
const seen = [];
const server = http.createServer((req, res) => {
  let raw = "";
  req.setEncoding("utf8"); req.on("data", (x) => raw += x); req.on("end", () => {
    seen.push({ url: req.url, headers: req.headers, body: JSON.parse(raw) });
    res.setHeader("content-type", "application/json");
    const response = req.url.includes("publishers/google") ? { candidates: [{ content: { parts: [{ text: "구글 결과" }] } }] } : req.url.includes("translate-google") ? { data: { translations: [{ translatedText: "Hello &amp; welcome" }] } } : { data: { text: "로컬 결과" } };
    res.end(JSON.stringify(response));
  });
});

try {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port, api = new AiTools({ dir, crypt });
  let tools = api.save({ name: "로컬 번역", icon: "번역", color: "#2255aa", provider: "custom", endpoint: `http://127.0.0.1:${port}/translate`, model: "", apiKey: "", prompt: "{{sourceLanguage}}>{{targetLanguage}}|{{era}}|{{age}}|{{tone}}|{{character}}|{{originalText}}|{{translatedText}}", requestJson: '{"sentence":"{{prompt}}"}', resultPath: "data.text", authHeader: "Authorization", authPrefix: "Bearer ", designHtml: '<textarea data-api-input></textarea><button data-api-action="run">실행</button><textarea data-api-output></textarea>', view: "float", side: "right" });
  assert.equal(tools[0].hasKey, false);
  assert.match(tools[0].designHtml, /data-api-input/);
  assert.equal((await api.run(tools[0].id, "테스트 문장", { sourceLanguage: "ko", targetLanguage: "ja", era: "현대", age: "청년", tone: "정중함", character: "차분함", translatedText: "번역 초안" })).output, "로컬 결과");
  assert.deepEqual(seen[0].body, { sentence: "ko>ja|현대|청년|정중함|차분함|테스트 문장|번역 초안" });

  tools = api.save({ name: "Vertex", icon: "G", color: "#118855", provider: "vertex", endpoint: `http://127.0.0.1:${port}/v1`, model: "gemini-test", apiKey: "secret", prompt: "{{text}}", view: "side", side: "left" });
  const vertex = tools.find((x) => x.name === "Vertex");
  assert.equal((await api.run(vertex.id, "클라우드 문장")).output, "구글 결과");
  assert.equal(seen[1].headers["x-goog-api-key"], "secret");
  assert.match(seen[1].url, /publishers\/google\/models\/gemini-test:generateContent$/);

  tools = api.save({ name: "Google Cloud", icon: "G", color: "#3367d6", provider: "google_cloud", endpoint: `http://127.0.0.1:${port}/translate-google`, model: "", apiKey: "cloud-key", prompt: "{{text}}", view: "float", side: "right" });
  const cloud = tools.find((x) => x.name === "Google Cloud");
  assert.equal((await api.run(cloud.id, "안녕하세요", { sourceLanguage: "ko", targetLanguage: "en" })).output, "Hello & welcome");
  assert.equal(seen[2].headers["x-goog-api-key"], "cloud-key");
  assert.deepEqual(seen[2].body, { q: "안녕하세요", source: "ko", target: "en", format: "text" });
  console.log("사용자 지정 로컬 API·Google Cloud Translation API·Vertex API 저장 및 호출 검사 통과");
} finally {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(dir, { recursive: true, force: true });
}

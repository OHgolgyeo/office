// Google 문서로 보내기(Electron 메인 프로세스).
//  - 사용자가 각자 Google Cloud 에 등록한 "데스크톱 앱" OAuth 클라이언트 ID를 쓴다.
//    데스크톱 앱은 공개 클라이언트이므로 보안 비밀은 선택 사항이며, PKCE로 인증 코드를 보호한다.
//  - 로그인은 기본 브라우저에서(루프백 주소 + PKCE). 오골계 워드는 비밀번호를 보지 않는다.
//  - drive.file 로 만든 파일을 올리고, drive.readonly 로 사용자가 고른 기존 파일을 읽는다.
//  - 토큰은 Electron safeStorage 로 암호화해 사용자 데이터 폴더에 둔다.
// 이 기능을 쓸 때만 인터넷을 쓴다.
import http from "http";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { docsToModel, tabRequests } from "./gdoc-tabs.js";

const EP = {                                              // 시험할 때는 환경 변수로 가짜 서버를 가리킬 수 있다
  auth: process.env.OG_GOOGLE_AUTH || "https://accounts.google.com/o/oauth2/v2/auth",
  token: process.env.OG_GOOGLE_TOKEN || "https://oauth2.googleapis.com/token",
  revoke: process.env.OG_GOOGLE_REVOKE || "https://oauth2.googleapis.com/revoke",
  upload: process.env.OG_GOOGLE_UPLOAD || "https://www.googleapis.com/upload/drive/v3/files",
  docs: process.env.OG_GOOGLE_DOCS || "https://docs.googleapis.com/v1/documents",
  files: process.env.OG_GOOGLE_FILES || "https://www.googleapis.com/drive/v3/files",
};
// drive.file: 오골계 워드가 만든 파일(보내기) / drive.readonly: 드라이브의 파일 목록·받기(가져오기)
const READ_SCOPE = "https://www.googleapis.com/auth/drive.readonly";
const SCOPE = "https://www.googleapis.com/auth/drive.file " + READ_SCOPE;
const MIME = {
  folder: "application/vnd.google-apps.folder", gdoc: "application/vnd.google-apps.document", pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};
/** 드라이브 파일 종류: folder / gdoc / pdf / docx / hwp / 그 밖(null) */
export function driveKind(f) {
  const name = String(f.name || "").toLowerCase(), m = String(f.mimeType || "").toLowerCase();
  if (m === MIME.folder) return "folder";
  if (m === MIME.gdoc) return "gdoc";
  if (m === MIME.pdf || name.endsWith(".pdf")) return "pdf";
  if (m === MIME.docx || name.endsWith(".docx")) return "docx";
  if (/\.(hwp|hwpx)$/.test(name) || /hwp|hancom|haansoft/.test(m)) return "hwp";
  return null;
}
const b64url = (buf) => Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export class GoogleDocs {
  /** dir: 저장 폴더, crypt: { encrypt(str)→Buffer, decrypt(Buffer)→str }, openExternal(url) */
  constructor({ dir, crypt, openExternal }) {
    this.file = path.join(dir, "google-connection.bin");
    this.crypt = crypt; this.openExternal = openExternal;
    this.state = this.load();
    this.access = null;                                   // { token, expires }
  }
  load() {
    try { return JSON.parse(this.crypt.decrypt(fs.readFileSync(this.file))); } catch { return {}; }
  }
  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, this.crypt.encrypt(JSON.stringify(this.state)));
  }
  status() {
    const connected = !!this.state.refreshToken;
    // 가져오기는 읽기 권한이 필요하다(예전에 보내기 권한만으로 연결했다면 다시 연결해야 한다)
    return { clientId: this.state.clientId || "", hasSecret: !!this.state.clientSecret, connected, canBrowse: connected && String(this.state.scope || "").includes(READ_SCOPE), account: this.state.account || "" };
  }
  setClient(clientId, clientSecret) {
    const id = String(clientId || "").trim(), secret = String(clientSecret || "").trim();
    if (!/\.apps\.googleusercontent\.com$/.test(id)) throw new Error("클라이언트 ID 형식이 아닙니다. …apps.googleusercontent.com 으로 끝나는 값을 넣어 주세요.");
    const changed = id !== this.state.clientId;
    this.state.clientId = id;
    if (secret) this.state.clientSecret = secret;
    if (changed) { delete this.state.refreshToken; delete this.state.account; this.access = null; }   // 다른 클라이언트면 다시 연결
    this.save();
    return this.status();
  }

  /** 기본 브라우저에서 로그인·허용 → 루프백 주소로 받은 코드를 토큰으로 바꾼다 */
  async connect() {
    if (!this.state.clientId) throw new Error("먼저 데스크톱 앱의 클라이언트 ID를 넣어 주세요.");
    const verifier = b64url(crypto.randomBytes(48));
    const challenge = b64url(crypto.createHash("sha256").update(verifier).digest());
    const stateTag = b64url(crypto.randomBytes(16));
    const { code, redirect } = await new Promise((resolve, reject) => {
      let redirectUri = "";                                 // 서버를 연 뒤 정한다(닫은 뒤에는 주소를 읽을 수 없으므로 미리 둔다)
      const server = http.createServer((req, res) => {
        const u = new URL(req.url, "http://127.0.0.1");
        if (u.pathname !== "/") { res.writeHead(404).end(); return; }
        const done = (ok, msg) => {
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(`<!doctype html><meta charset="utf-8"><title>오골계 워드</title><body style="font-family:sans-serif;padding:40px"><h2>${ok ? "Google 드라이브 연결이 끝났습니다." : "Google 드라이브 연결을 하지 못했습니다."}</h2><p>${msg}</p><p>이 창을 닫고 오골계 워드로 돌아가세요.</p></body>`);
          clearTimeout(timer); server.close();
        };
        if (u.searchParams.get("state") !== stateTag) { done(false, "요청이 일치하지 않습니다."); reject(new Error("인증 응답이 일치하지 않습니다.")); return; }
        if (u.searchParams.get("error")) { done(false, "허용하지 않았습니다."); reject(new Error("Google 에서 허용하지 않았습니다: " + u.searchParams.get("error"))); return; }
        done(true, "");
        resolve({ code: u.searchParams.get("code"), redirect: redirectUri });
      });
      const timer = setTimeout(() => { server.close(); reject(new Error("5분 안에 로그인을 마치지 않아 연결을 취소했습니다.")); }, 5 * 60 * 1000);
      server.listen(0, "127.0.0.1", () => {
        redirectUri = `http://127.0.0.1:${server.address().port}`;
        const url = `${EP.auth}?` + new URLSearchParams({
          client_id: this.state.clientId, redirect_uri: redirectUri, response_type: "code", scope: SCOPE,
          code_challenge: challenge, code_challenge_method: "S256", access_type: "offline", prompt: "consent", state: stateTag,
        });
        Promise.resolve(this.openExternal(url)).catch((e) => { clearTimeout(timer); server.close(); reject(e); });
      });
    });
    const tok = await this.tokenRequest({ grant_type: "authorization_code", code, redirect_uri: redirect, code_verifier: verifier });
    if (!tok.refresh_token) throw new Error("Google 이 갱신 토큰을 주지 않았습니다. 다시 연결해 주세요.");
    this.state.refreshToken = tok.refresh_token;
    this.state.scope = tok.scope || SCOPE;
    this.access = { token: tok.access_token, expires: Date.now() + (tok.expires_in - 60) * 1000 };
    this.save();
    return this.status();
  }
  async tokenRequest(params) {
    const form = { client_id: this.state.clientId, ...params };
    if (this.state.clientSecret) form.client_secret = this.state.clientSecret;
    const r = await fetch(EP.token, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(form) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error("Google 인증 실패: " + (j.error_description || j.error || r.status));
    return j;
  }
  async accessToken() {
    if (this.access && this.access.expires > Date.now()) return this.access.token;
    if (!this.state.refreshToken) throw new Error("Google 에 연결되어 있지 않습니다. 환경 설정 → Google 드라이브 연결에서 연결해 주세요.");
    try {
      const tok = await this.tokenRequest({ grant_type: "refresh_token", refresh_token: this.state.refreshToken });
      this.access = { token: tok.access_token, expires: Date.now() + (tok.expires_in - 60) * 1000 };
      return this.access.token;
    } catch (e) {
      if (/invalid_grant/.test(e.message)) { delete this.state.refreshToken; this.save(); throw new Error("Google 드라이브 연결이 만료되었습니다. 다시 연결해 주세요."); }
      throw e;
    }
  }
  async disconnect() {
    const t = this.state.refreshToken;
    delete this.state.refreshToken; delete this.state.account; delete this.state.scope; this.access = null; this.save();
    if (t) await fetch(`${EP.revoke}?token=${encodeURIComponent(t)}`, { method: "POST" }).catch(() => null);   // 실패해도 이 컴퓨터에서는 지운다
    return this.status();
  }

  /** Word 파일을 올리면서 Google 문서로 변환하고, 페이지 없음이면 그렇게 바꾼다 */
  async batch(id, requests) {
    const r = await this.api(`${EP.docs}/${encodeURIComponent(id)}:batchUpdate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requests }) });
    return r.json();
  }
  async send({ docx, title, pageless, tabs }) {
    const token = await this.accessToken();
    const boundary = "ogolgye-" + crypto.randomBytes(12).toString("hex");
    const meta = JSON.stringify({ name: title || "오골계 워드 문서", mimeType: "application/vnd.google-apps.document" });
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: ${MIME.docx}\r\n\r\n`, "utf8"),
      Buffer.from(docx),
      Buffer.from(`\r\n--${boundary}--\r\n`, "utf8"),
    ]);
    const up = await fetch(`${EP.upload}?uploadType=multipart&fields=id,name,webViewLink`, {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": `multipart/related; boundary=${boundary}` }, body,
    });
    const file = await up.json().catch(() => ({}));
    if (!up.ok || !file.id) throw new Error("Google 드라이브에 올리지 못했습니다: " + (file.error?.message || up.status));
    let pagelessApplied = false, warning = "";
    if (pageless) {
      try { await this.batch(file.id, [{ updateDocumentStyle: { documentStyle: { documentFormat: { documentMode: "PAGELESS" } }, fields: "documentFormat" } }]); pagelessApplied = true; }
      catch (e) { warning = "문서는 올렸지만 페이지 없음으로 바꾸지 못했습니다: " + (e.message || e); }
    }
    // 보내기에서 첫 탭은 Word 변환 결과를 쓰고, 둘째 탭부터 새 Google 문서 탭을 만들어 채운다
    let tabsMade = 0, skippedImages = 0;
    if (Array.isArray(tabs) && tabs.length > 1) {
      try {
        try {                                                  // 첫 탭 이름(지원되지 않으면 그대로 둔다)
          const d0 = await (await this.api(`${EP.docs}/${encodeURIComponent(file.id)}?includeTabsContent=true&fields=tabs(tabProperties)`)).json();
          const firstId = d0.tabs && d0.tabs[0] && d0.tabs[0].tabProperties && d0.tabs[0].tabProperties.tabId;
          if (firstId) await this.batch(file.id, [{ updateDocumentTabProperties: { tabProperties: { tabId: firstId, title: tabs[0].name }, fields: "title" } }]);
        } catch { /* 이름 바꾸기는 선택 */ }
        const added = await this.batch(file.id, tabs.slice(1).map((t, k) => ({ addDocumentTab: { tabProperties: { title: t.name, index: k + 1 } } })));
        const ids = (added.replies || []).map((x) => x.addDocumentTab && x.addDocumentTab.tabProperties && x.addDocumentTab.tabProperties.tabId);
        for (let k = 1; k < tabs.length; k++) {
          const tabId = ids[k - 1]; if (!tabId) continue;
          const { requests, skippedImages: sk } = tabRequests(tabs[k].blocks, tabId);
          skippedImages += sk;
          if (pageless) requests.push({ updateDocumentStyle: { tabId, documentStyle: { documentFormat: { documentMode: "PAGELESS" } }, fields: "documentFormat" } });
          if (requests.length) await this.batch(file.id, requests);
          tabsMade++;
        }
      } catch (e) { warning = (warning ? warning + " / " : "") + "탭을 모두 만들지 못했습니다: " + (e.message || e); }
      if (skippedImages) warning = (warning ? warning + " / " : "") + `둘째 탭부터의 그림 ${skippedImages}개는 옮기지 못했습니다(Google 문서 API 는 공개 주소의 그림만 넣을 수 있습니다).`;
    }
    const url = file.webViewLink || `https://docs.google.com/document/d/${file.id}/edit`;
    await Promise.resolve(this.openExternal(url)).catch(() => null);
    return { id: file.id, url, pagelessApplied, warning, tabsMade };
  }

  async api(url, opt = {}) {
    const token = await this.accessToken();
    const r = await fetch(url, { ...opt, headers: { ...(opt.headers || {}), Authorization: `Bearer ${token}` } });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      if (r.status === 403 || r.status === 401) throw new Error("Google 드라이브를 읽을 권한이 없습니다. 환경 설정 → Google 드라이브 연결에서 다시 연결해 주세요." + (j.error?.message ? ` (${j.error.message})` : ""));
      throw new Error("Google 드라이브 요청 실패: " + (j.error?.message || r.status));
    }
    return r;
  }
  /** 드라이브 목록: folderId(기본 내 드라이브) 또는 검색어, 공유 문서함. 폴더와 가져올 수 있는 파일만 */
  async list({ folderId = "root", query = "", shared = false, pageToken = "" } = {}) {
    if (!this.status().canBrowse) throw new Error("드라이브에서 가져오려면 환경 설정 → Google 드라이브 연결에서 다시 연결해 주세요(읽기 권한 추가).");
    const esc = (v) => String(v).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    const q = ["trashed = false", query ? `name contains '${esc(query)}'` : shared ? "sharedWithMe = true" : `'${esc(folderId)}' in parents`].join(" and ");
    const params = new URLSearchParams({ q, pageSize: "200", orderBy: "folder,name_natural", fields: "nextPageToken,files(id,name,mimeType,modifiedTime,size)", supportsAllDrives: "true", includeItemsFromAllDrives: "true" });
    if (pageToken) params.set("pageToken", pageToken);
    const j = await (await this.api(`${EP.files}?${params}`)).json();
    const files = (j.files || []).map((f) => ({ ...f, kind: driveKind(f) })).filter((f) => f.kind);
    return { files, nextPageToken: j.nextPageToken || "" };
  }
  /** 파일 하나 가져오기: hwp·pdf·docx 는 원본, Google 문서는 Docs API 로 탭·본문·보기 방식을 직접 읽는다 */
  async fetchFile(id) {
    const meta = await (await this.api(`${EP.files}/${encodeURIComponent(id)}?fields=id,name,mimeType&supportsAllDrives=true`)).json();
    const kind = driveKind(meta);
    if (!kind || kind === "folder") throw new Error("가져올 수 없는 파일입니다: " + meta.name);
    if (kind === "gdoc") {
      // 문서 API 로 탭 구조와 내용을 그대로 받는다(그림은 문서가 알려 주는 주소에서 받는다)
      const doc = await (await this.api(`${EP.docs}/${encodeURIComponent(id)}?includeTabsContent=true`)).json();
      const fetchImage = async (uri) => {
        const r = await this.api(uri);
        const mime = (r.headers.get("content-type") || "image/png").split(";")[0];
        return { mime, b64: Buffer.from(await r.arrayBuffer()).toString("base64") };
      };
      const model = await docsToModel(doc, fetchImage);
      return { kind: "model", name: meta.name, model: { title: meta.name, tabs: model.tabs }, pageless: model.pageless, source: "gdoc" };
    }
    const bytes = Buffer.from(await (await this.api(`${EP.files}/${encodeURIComponent(id)}?alt=media&supportsAllDrives=true`)).arrayBuffer());
    return { kind, name: meta.name, bytes, pageless: null, source: kind };
  }
}

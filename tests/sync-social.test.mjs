// node --test tests/sync-social.test.mjs — sem rede: APIs de YouTube, Instagram, TikTok e LinkedIn simuladas.
// A barra invertida dos textos do LinkedIn é montada por código (BS) para não depender de escapes.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configFromEnv, syncSocial, parseDuration, linkedinVersion, linkedinText } from "../scripts/sync-social.mjs";
import { isNetworkUrl, youtubeId, profileIdentity, accountMatch, defaultProfiles } from "../src/config/social.ts";

const BS = String.fromCharCode(92);
const T0 = Date.parse("2026-10-06T12:00:00Z");
const DAY = 86400000;
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const webp = async (bytes) => Buffer.concat([Buffer.from("RIFF0000WEBP"), bytes]);
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const image = () => new Response(JPG, { headers: { "content-type": "image/jpeg" } });

/** fetch simulado: rotas [trecho da URL, () => Response]; o que não casar é falha de rede. */
function fakeApi(routes) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const href = String(url);
    calls.push({ url: href, init });
    const route = routes.find(([match]) => href.includes(match));
    if (route) return route[1](href, init);
    throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ENOTFOUND" } });
  };
  return { fetchImpl, calls };
}

async function setup(t, env = {}) {
  const dir = await mkdtemp(join(tmpdir(), "mag-social-"));
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  return configFromEnv({ SOCIAL_OUTPUT_DIR: join(dir, "social"), SOCIAL_STATE_DIR: join(dir, "state"), ...env });
}
const run = (config, api, at = T0) => syncSocial(config, { fetchImpl: api.fetchImpl, processImage: webp, now: () => at });
const content = async (config) => JSON.parse(await readFile(config.contentPath, "utf8"));
const statusFile = async (config) => JSON.parse(await readFile(config.statusPath, "utf8"));
const images = async (config) => (await readdir(config.imageDir).catch(() => [])).sort();
/** Tudo o que o site e o painel podem ler (cache, estado, histórico): nenhum segredo pode aparecer aqui. */
const publicFiles = async (config) => (await Promise.all([config.contentPath, config.statusPath, config.historyPath]
  .map((path) => readFile(path, "utf8").catch(() => "")))).join("\n");

const YT = { YOUTUBE_API_KEY: "AIzaSyFAKEKEY1234567890", YOUTUBE_CHANNEL_ID: "UC1234567890abcdefghijkl" };
const ytVideo = (id, extra = {}) => ({
  id, snippet: { title: `Vídeo ${id}`, publishedAt: "2026-10-01T12:00:00Z", channelTitle: "MAG Móveis", thumbnails: { high: { url: `https://i.ytimg.com/vi/${id}/hqdefault.jpg` } } },
  contentDetails: { duration: "PT1M5S" }, status: { privacyStatus: "public" }, ...extra,
});
const youtubeRoutes = (videos) => [
  ["youtube/v3/channels", () => json({ items: [{ contentDetails: { relatedPlaylists: { uploads: "UU1234567890abcdefghijkl" } }, snippet: { title: "MAG", customUrl: "@MagMoveisCorporativos7222" } }] })],
  ["youtube/v3/playlistItems", () => json({ items: videos.map((video) => ({ contentDetails: { videoId: video.id } })) })],
  ["youtube/v3/videos", () => json({ items: videos })],
  ["i.ytimg.com", () => image()],
];

const IG = { INSTAGRAM_ACCESS_TOKEN: "IGQVJtokenORIGINAL123" };
const instagramRoutes = (onRefresh = () => json({ access_token: "IGQVJtokenNOVO456", expires_in: 5184000 })) => [
  ["graph.instagram.com/refresh_access_token", onRefresh],
  ["graph.instagram.com/v22.0/me/media", () => json({ data: [
    { id: "1801", media_type: "VIDEO", media_product_type: "REELS", media_url: "https://video.cdn.test/reel.mp4", thumbnail_url: "https://scontent.cdn.test/capa.jpg",
      permalink: "https://www.instagram.com/reel/AbC/", timestamp: "2026-10-02T10:00:00+0000", caption: "Montagem de estações", username: "magmoveiscorporativos" },
    { id: "1802", media_type: "IMAGE", media_url: "https://scontent.cdn.test/foto.jpg", permalink: "https://www.instagram.com/p/DeF/", timestamp: "2026-10-01T10:00:00+0000", caption: "Cadeira nova" },
    { id: "1803", media_type: "IMAGE", media_url: "https://scontent.cdn.test/x.jpg", permalink: "https://golpe.example/p/1803", caption: "fora do Instagram" },
  ] })],
  ["scontent.cdn.test", () => image()],
  ["graph.instagram.com/v22.0/me?fields=user_id,username", () => json({ user_id: "17841400000000000", username: "magmoveiscorporativos" })],
];

test("sem credencial nenhuma: zero chamadas externas, tudo desconectado, e a 2ª execução não regrava o conteúdo", async (t) => {
  const config = await setup(t);
  const api = fakeApi([]);
  const first = await run(config, api);
  assert.equal(api.calls.length, 0);
  for (const network of ["youtube", "instagram", "tiktok", "linkedin"]) {
    assert.equal(first.status[network].status, "desconectado");
    assert.equal(first.status[network].configured, false);
  }
  assert.equal(first.changed, true, "1ª execução cria o social.json vazio");
  const before = await readFile(config.contentPath, "utf8");
  const second = await run(config, api, T0 + 3600000);
  assert.equal(second.changed, false);
  assert.equal(await readFile(config.contentPath, "utf8"), before, "social.json idêntico (nem a data muda)");
  assert.equal((await statusFile(config)).checkedAt, new Date(T0 + 3600000).toISOString(), "o estado registra cada verificação");
  assert.equal((await readFile(config.historyPath, "utf8")).trim().split("\n").length, 2);
});

test("YouTube: playlist de uploads (sem Search API), só vídeo público, 16:9, duração e miniatura local", async (t) => {
  const config = await setup(t, YT);
  const api = fakeApi(youtubeRoutes([ytVideo("aaaaaaaaaaa"), ytVideo("bbbbbbbbbbb", { status: { privacyStatus: "private" } })]));
  const result = await run(config, api);
  assert.equal(result.status.youtube.status, "conectado");
  assert.ok(!api.calls.some((call) => call.url.includes("/search")), "Search API não é usada");
  assert.equal(api.calls.filter((call) => call.url.includes("googleapis.com")).length, 3, "channels + playlistItems + videos");
  const [video, ...rest] = (await content(config)).providers.youtube.items;
  assert.equal(rest.length, 0, "vídeo privado fica fora");
  assert.equal(video.url, "https://www.youtube.com/watch?v=aaaaaaaaaaa");
  assert.deepEqual(video.metadata, { aspect: "16:9", youtube_id: "aaaaaaaaaaa" });
  assert.equal(video.duration, 65);
  assert.match(video.thumbnail, /^[a-f0-9]{64}[.]webp$/);
  assert.deepEqual(await images(config), [video.thumbnail]);
  assert.deepEqual(result.status.youtube.account, { id: YT.YOUTUBE_CHANNEL_ID, name: "MAG", handle: "magmoveiscorporativos7222" }, "canal sincronizado aparece no painel");
  assert.deepEqual(Object.keys(video).sort(), ["author", "duration", "external_id", "metadata", "provider", "published_at", "thumbnail", "title", "type", "url"]);
  const files = await publicFiles(config);
  assert.ok(!files.includes(YT.YOUTUBE_API_KEY), "chave da API fora do cache");
  assert.ok(!files.includes("i.ytimg.com"), "URL remota da imagem não vai ao site");
});

test("Instagram: reels 9:16, imagem 1:1, só a capa do vídeo (nunca o MP4), token renovado a cada 7 dias fora do site", async (t) => {
  const config = await setup(t, IG);
  const api = fakeApi(instagramRoutes());
  const result = await run(config, api);
  assert.equal(result.status.instagram.status, "conectado");
  const items = (await content(config)).providers.instagram.items;
  assert.deepEqual(items.map((item) => [item.external_id, item.type, item.metadata.aspect]), [["1801", "reel", "9:16"], ["1802", "image", "1:1"]], "link fora do Instagram é descartado");
  assert.ok(!api.calls.some((call) => call.url.includes(".mp4")), "o vídeo nunca é baixado");
  assert.ok(api.calls.some((call) => call.url.includes("/me/media") && call.url.includes("IGQVJtokenNOVO456")), "usa o token renovado");
  assert.deepEqual(result.status.instagram.account, { id: "17841400000000000", name: "@magmoveiscorporativos", handle: "magmoveiscorporativos" }, "conta do token aparece no painel");
  const state = JSON.parse(await readFile(join(config.stateDir, "tokens.json"), "utf8"));
  assert.equal(state.instagram.access_token, "IGQVJtokenNOVO456");
  if (process.platform !== "win32") assert.equal((await stat(join(config.stateDir, "tokens.json"))).mode & 0o777, 0o600);
  const files = await publicFiles(config);
  for (const secret of ["IGQVJtokenORIGINAL123", "IGQVJtokenNOVO456"]) assert.ok(!files.includes(secret), `token ${secret} fora do cache`);

  const refreshes = () => api.calls.filter((call) => call.url.includes("refresh_access_token")).length;
  await run(config, api, T0 + DAY);
  assert.equal(refreshes(), 1, "dentro de 7 dias não renova de novo");
  await run(config, api, T0 + 8 * DAY);
  assert.equal(refreshes(), 2, "depois de 7 dias renova");
});

test("Instagram: renovação recusada (token com menos de 24 h) não impede a sincronização", async (t) => {
  const config = await setup(t, IG);
  const api = fakeApi(instagramRoutes(() => json({ error: { code: 190, type: "OAuthException" } }, 400)));
  const result = await run(config, api);
  assert.equal(result.status.instagram.status, "conectado");
  assert.ok(api.calls.some((call) => call.url.includes("/me/media") && call.url.includes("IGQVJtokenORIGINAL123")));
});

test("TikTok: refresh token → lista de vídeos 9:16; token novo guardado só no estado", async (t) => {
  const config = await setup(t, { TIKTOK_CLIENT_KEY: "awfakeclientkey", TIKTOK_CLIENT_SECRET: "tiktoksecret123", TIKTOK_REFRESH_TOKEN: "rft.refresh123456" });
  const api = fakeApi([
    ["open.tiktokapis.com/v2/oauth/token/", () => json({ access_token: "act.access123456", expires_in: 86400, refresh_token: "rft.refresh789012", refresh_expires_in: 31536000 })],
    ["open.tiktokapis.com/v2/video/list/", () => json({ data: { videos: [
      { id: "7300000000000000001", title: "Montagem em 30 s", cover_image_url: "https://p16.tiktokcdn.test/capa.jpeg", share_url: "https://www.tiktok.com/@mag/video/7300000000000000001", create_time: 1759400000, duration: 30 },
      { id: "7300000000000000002", title: "fora", share_url: "https://golpe.example/v/2", create_time: 1759300000, duration: 10 },
    ] }, error: { code: "ok" } })],
    ["tiktokcdn.test", () => image()],
    ["open.tiktokapis.com/v2/user/info/", () => json({ data: { user: { open_id: "open-123", display_name: "MAG Móveis" } }, error: { code: "ok" } })],
  ]);
  const result = await run(config, api);
  assert.equal(result.status.tiktok.status, "conectado");
  assert.deepEqual(result.status.tiktok.account, { id: "open-123", name: "MAG Móveis", handle: "mag" }, "@usuário tirado do link do vídeo");
  const list = api.calls.find((call) => call.url.includes("/video/list/"));
  assert.equal(list.init.headers.Authorization, "Bearer act.access123456");
  const [video, ...rest] = (await content(config)).providers.tiktok.items;
  assert.equal(rest.length, 0);
  assert.equal(video.type, "short");
  assert.equal(video.metadata.aspect, "9:16");
  assert.equal(video.duration, 30);
  assert.equal(video.published_at, new Date(1759400000 * 1000).toISOString());
  const state = JSON.parse(await readFile(join(config.stateDir, "tokens.json"), "utf8"));
  assert.equal(state.tiktok.refresh_token, "rft.refresh789012", "refresh token novo guardado");
  const files = await publicFiles(config);
  for (const secret of ["tiktoksecret123", "rft.refresh123456", "rft.refresh789012", "act.access123456"]) assert.ok(!files.includes(secret));
  // dentro da validade não pede token de novo
  await run(config, api, T0 + 3600000);
  assert.equal(api.calls.filter((call) => call.url.includes("/oauth/token/")).length, 1);
});

test("LinkedIn: só publicações PUBLISHED e PUBLIC da organização; texto limpo; imagem via /rest/images", async (t) => {
  const config = await setup(t, { LINKEDIN_ORGANIZATION_ID: "12345", LINKEDIN_ACCESS_TOKEN: "AQVlinkedintoken123" });
  const api = fakeApi([
    ["api.linkedin.com/rest/posts", () => json({ elements: [
      { id: "urn:li:share:111", lifecycleState: "PUBLISHED", visibility: "PUBLIC", commentary: `Entrega {hashtag|${BS}#|MAG} para @[Cliente](urn:li:organization:9)`,
        content: { media: { id: "urn:li:image:C4D00AAA" } }, publishedAt: Date.parse("2026-10-03T15:00:00Z") },
      { id: "urn:li:share:222", lifecycleState: "DRAFT", visibility: "PUBLIC", commentary: "rascunho" },
      { id: "urn:li:ugcPost:333", lifecycleState: "PUBLISHED", visibility: "CONNECTIONS", commentary: "só conexões" },
    ] })],
    ["api.linkedin.com/rest/images/", () => json({ downloadUrl: "https://media.licdn.test/imagem.jpg" })],
    ["media.licdn.test", () => image()],
    ["api.linkedin.com/rest/organizationsLookup?ids=List(12345)", () => json({ results: { 12345: { id: 12345, vanityName: "MagMoveisCorporativos", localizedName: "MAG Móveis Corporativos" } } })],
  ]);
  const result = await run(config, api);
  assert.equal(result.status.linkedin.status, "conectado");
  const posts = api.calls.find((call) => call.url.includes("/rest/posts"));
  assert.match(posts.init.headers["LinkedIn-Version"], /^[0-9]{6}$/);
  assert.ok(posts.url.includes(encodeURIComponent("urn:li:organization:12345")));
  assert.deepEqual(result.status.linkedin.account, { id: "urn:li:organization:12345", name: "MAG Móveis Corporativos", handle: "magmoveiscorporativos" }, "sempre a organização informada, com a página dela");
  const [post, ...rest] = (await content(config)).providers.linkedin.items;
  assert.equal(rest.length, 0, "rascunho e post só para conexões ficam fora");
  assert.equal(post.title, "Entrega #MAG para Cliente");
  assert.equal(post.url, "https://www.linkedin.com/feed/update/urn:li:share:111/");
  assert.ok(post.thumbnail);
  assert.ok(!(await publicFiles(config)).includes("AQVlinkedintoken123"));
});

test("erro numa rede: mantém o último conteúdo bom, registra o erro sem segredo e as outras seguem", async (t) => {
  const config = await setup(t, { ...YT, ...IG });
  const ok = fakeApi([...youtubeRoutes([ytVideo("aaaaaaaaaaa")]), ...instagramRoutes()]);
  await run(config, ok);
  const before = (await content(config)).providers.youtube;
  const thumbs = await images(config);

  const failures = [
    ["cota", () => json({ error: { code: 403, errors: [{ reason: "quotaExceeded" }] } }, 403), "youtube: HTTP 403 (quotaExceeded)"],
    ["rede", () => { throw Object.assign(new TypeError(`fetch failed ${YT.YOUTUBE_API_KEY}`), { cause: { code: "ECONNREFUSED" } }); }, "youtube: falha de rede (ECONNREFUSED)"],
    ["200 sem JSON", () => new Response("<html>proxy</html>", { status: 200, headers: { "content-type": "text/html" } }), "youtube: resposta inválida"],
  ];
  for (const [label, reply, expected] of failures) {
    const api = fakeApi([["youtube/v3/channels", reply], ...instagramRoutes()]);
    const result = await run(config, api, T0 + 3600000);
    assert.equal(result.status.youtube.status, "erro", label);
    assert.equal(result.status.youtube.error, expected, label);
    assert.equal(result.status.youtube.itemCount, 1, `${label}: conta o conteúdo mantido`);
    assert.equal(result.status.youtube.lastSuccessAt, new Date(T0).toISOString(), `${label}: último sucesso preservado`);
    assert.equal(result.status.instagram.status, "conectado", `${label}: Instagram não é afetado`);
    assert.deepEqual((await content(config)).providers.youtube, before, `${label}: último conteúdo bom fica no site`);
    assert.deepEqual(await images(config), thumbs, `${label}: miniaturas mantidas`);
    assert.ok(!(await publicFiles(config)).includes(YT.YOUTUBE_API_KEY), `${label}: sem chave no estado`);
  }
});

test("conteúdo igual não regrava; publicação que sai da lista leva a miniatura junto", async (t) => {
  const config = await setup(t, YT);
  await run(config, fakeApi(youtubeRoutes([ytVideo("aaaaaaaaaaa"), ytVideo("bbbbbbbbbbb")])));
  assert.equal((await images(config)).length, 2);
  const before = await readFile(config.contentPath, "utf8");
  const same = await run(config, fakeApi(youtubeRoutes([ytVideo("aaaaaaaaaaa"), ytVideo("bbbbbbbbbbb")])), T0 + 3600000);
  assert.equal(same.changed, false);
  assert.equal(await readFile(config.contentPath, "utf8"), before);
  const fewer = await run(config, fakeApi(youtubeRoutes([ytVideo("aaaaaaaaaaa")])), T0 + 7200000);
  assert.equal(fewer.changed, true);
  const [kept] = (await content(config)).providers.youtube.items;
  assert.deepEqual(await images(config), [kept.thumbnail], "a miniatura do vídeo que saiu foi apagada");
});

test("credencial removida: a rede volta a desconectado e o conteúdo dela sai do site", async (t) => {
  const config = await setup(t, YT);
  await run(config, fakeApi(youtubeRoutes([ytVideo("aaaaaaaaaaa")])));
  const without = configFromEnv({ SOCIAL_OUTPUT_DIR: config.outputDir, SOCIAL_STATE_DIR: config.stateDir });
  const result = await run(without, fakeApi([]), T0 + 3600000);
  assert.equal(result.status.youtube.status, "desconectado");
  assert.equal((await content(config)).providers.youtube.items.length, 0);
  assert.deepEqual(await images(config), []);
});

test("miniatura: vídeo, HTML e arquivo grande não são baixados (leitura para no limite)", async (t) => {
  const config = await setup(t, YT);
  let pulled = 0;
  const huge = () => new Response(new ReadableStream({
    pull(controller) { pulled += 1; controller.enqueue(new Uint8Array(1024 * 1024)); if (pulled >= 64) controller.close(); },
  }), { headers: { "content-type": "image/jpeg" } });
  const cases = [
    ["vídeo", () => new Response(JPG, { headers: { "content-type": "video/mp4" } })],
    ["html", () => new Response("<html></html>", { headers: { "content-type": "text/html" } })],
    ["grande sem content-length", huge],
  ];
  for (const [label, reply] of cases) {
    const routes = youtubeRoutes([ytVideo("ccccccccccc")]).map((route) => (route[0] === "i.ytimg.com" ? [route[0], reply] : route));
    const result = await run(config, fakeApi(routes), T0 + 30 * DAY);
    assert.equal(result.status.youtube.status, "conectado", label);
    assert.equal((await content(config)).providers.youtube.items[0].thumbnail, null, `${label}: sem miniatura`);
  }
  assert.ok(pulled <= 12, `parou perto de 8 MB (leu ${pulled} MB)`);
});

test("LinkedIn: no máximo a cada 6 h (limite do tier de desenvolvimento); --forcar ignora o intervalo", async (t) => {
  const config = await setup(t, { LINKEDIN_ORGANIZATION_ID: "12345", LINKEDIN_ACCESS_TOKEN: "AQVlinkedintoken123" });
  const routes = [["api.linkedin.com/rest/posts", () => json({ elements: [
    { id: "urn:li:share:111", lifecycleState: "PUBLISHED", visibility: "PUBLIC", commentary: "Entrega", publishedAt: Date.parse("2026-10-03T15:00:00Z") },
  ] })]];
  const calls = (api) => api.calls.filter((call) => call.url.includes("api.linkedin.com/rest/posts")).length;
  const first = fakeApi(routes);
  await run(config, first);
  assert.equal(calls(first), 1);
  const before = await readFile(config.contentPath, "utf8");
  const soon = fakeApi(routes);
  const skipped = await run(config, soon, T0 + 3600000);
  assert.equal(calls(soon), 0, "1 h depois: não chama a API");
  assert.equal(skipped.status.linkedin.status, "conectado");
  assert.equal(skipped.status.linkedin.lastAttemptAt, new Date(T0).toISOString(), "estado da última consulta real");
  assert.equal(await readFile(config.contentPath, "utf8"), before, "conteúdo mantido, sem regravar");
  const forced = fakeApi(routes);
  await run(configFromEnv({ ...config.env, SOCIAL_FORCE: "1" }), forced, T0 + 2 * 3600000);
  assert.equal(calls(forced), 1, "SOCIAL_FORCE=1 consulta na hora");
  const later = fakeApi(routes);
  await run(config, later, T0 + 9 * 3600000);
  assert.equal(calls(later), 1, "passadas 6 h da última consulta: consulta de novo");
});

test("utilitários: duração ISO, versão da API do LinkedIn, endereços oficiais e ID de vídeo", () => {
  assert.equal(parseDuration("PT1H2M3S"), 3723);
  assert.equal(parseDuration("P1DT1S"), 86401);
  assert.equal(parseDuration("lixo"), null);
  assert.equal(linkedinVersion(Date.parse("2026-10-06T12:00:00Z")), "202608");
  assert.equal(linkedinVersion(Date.parse("2026-01-31T12:00:00Z")), "202511");
  assert.equal(linkedinText(`{hashtag|${BS}#|MAG} ${BS}(teste${BS})`), "#MAG (teste)");
  assert.ok(isNetworkUrl("instagram", "https://www.instagram.com/magmoveiscorporativos"));
  assert.ok(isNetworkUrl("linkedin", "https://br.linkedin.com/company/mag"));
  assert.ok(!isNetworkUrl("instagram", "http://instagram.com/mag"), "só https");
  assert.ok(!isNetworkUrl("instagram", "https://instagram.com.golpe.example/mag"), "domínio parecido");
  assert.ok(!isNetworkUrl("youtube", "javascript:alert(1)"));
  assert.equal(youtubeId("https://www.youtube.com/watch?v=aaaaaaaaaaa&t=1"), "aaaaaaaaaaa");
  assert.equal(youtubeId("https://youtu.be/bbbbbbbbbbb"), "bbbbbbbbbbb");
  assert.equal(youtubeId("https://www.youtube.com/shorts/ccccccccccc"), "ccccccccccc");
  assert.equal(youtubeId("https://www.youtube.com/@canal"), null);
});

test("perfis oficiais confirmados: endereços exatos, modo manual e identidade esperada de cada um", () => {
  assert.deepEqual(Object.fromEntries(Object.entries(defaultProfiles).map(([network, profile]) => [network, [profile.url, profile.mode]])), {
    youtube: ["https://www.youtube.com/@magmoveiscorporativos7222", "manual"],
    instagram: ["https://instagram.com/magmoveiscorporativos", "manual"],
    tiktok: ["https://www.tiktok.com/@mag.moveis", "manual"],
    linkedin: ["https://www.linkedin.com/company/magmoveiscorporativos", "manual"],
  });
  for (const [network, profile] of Object.entries(defaultProfiles)) assert.ok(isNetworkUrl(network, profile.url), network);
  assert.deepEqual(profileIdentity("youtube", defaultProfiles.youtube.url), { handle: "magmoveiscorporativos7222", id: null });
  assert.deepEqual(profileIdentity("tiktok", defaultProfiles.tiktok.url), { handle: "mag.moveis", id: null });
  assert.deepEqual(profileIdentity("instagram", defaultProfiles.instagram.url), { handle: "magmoveiscorporativos", id: null });
  assert.deepEqual(profileIdentity("linkedin", defaultProfiles.linkedin.url), { handle: "magmoveiscorporativos", id: null });
  assert.deepEqual(profileIdentity("youtube", "https://www.youtube.com/channel/UC1234567890abcdefghijkl"), { handle: null, id: "UC1234567890abcdefghijkl" });
  assert.deepEqual(profileIdentity("instagram", "https://www.instagram.com/p/AbC/"), { handle: null, id: null }, "link de publicação não é perfil");
  assert.equal(accountMatch("tiktok", defaultProfiles.tiktok.url, { handle: "mag.moveis" }), "confere");
  assert.equal(accountMatch("tiktok", defaultProfiles.tiktok.url, { handle: "@Mag.Moveis" }), "confere", "sem @ e sem caixa");
  assert.equal(accountMatch("tiktok", defaultProfiles.tiktok.url, { handle: "outra.conta" }), "diverge");
  assert.equal(accountMatch("linkedin", defaultProfiles.linkedin.url, { id: "urn:li:organization:1", handle: "outra-pagina" }), "diverge", "a outra página da MAG nunca serve");
  assert.equal(accountMatch("linkedin", defaultProfiles.linkedin.url, { id: "urn:li:organization:1", handle: null }), "indefinido", "sem consulta da página: conferir no painel");
  assert.equal(accountMatch("youtube", "https://www.youtube.com/channel/UC1234567890abcdefghijkl", { id: "UC1234567890abcdefghijkl" }), "confere");
  assert.equal(accountMatch("instagram", defaultProfiles.instagram.url, null), "indefinido");
});

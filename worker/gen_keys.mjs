// Usage: node gen_keys.mjs 10 > seed.sql   (do NOT commit seed.sql)
// then:  npx wrangler d1 execute fixasif-db --remote --file=seed.sql
const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I
function genKey() {
  const out = [];
  while (out.length < 24) for (const x of crypto.getRandomValues(new Uint8Array(32))) {
    if (x < 256 - (256 % A.length)) out.push(A[x % A.length]);
    if (out.length === 24) break;
  }
  const s = out.join("");
  return "FIX-" + s.slice(0, 6) + "-" + s.slice(6, 12) + "-" + s.slice(12, 18) + "-" + s.slice(18, 24);
}
const n = Number(process.argv[2] || 10);
console.log("INSERT INTO access_keys (key, status) VALUES\n" + Array.from({ length: n }, () => "('" + genKey() + "','available')").join(",\n") + ";");

import http from "node:http";

// Deliberately independent of the workload builder. This is a synthetic
// response oracle, not a Next.js, database, ATS, or capacity benchmark.
const fixtureIds = new Map([
  ["/api/jobs?page=1", "synthetic-feed"],
  ["/api/jobs?titleSearch=engineer&page=1", "synthetic-title"],
  ["/api/jobs?region=CA&page=1", "synthetic-canada"],
  ["/api/jobs?region=US&page=1", "synthetic-us"],
  ["/api/jobs?locationSearch=Toronto&page=1", "synthetic-city"],
  ["/api/jobs?roleCategory=SOFTWARE_ENGINEERING&page=1", "synthetic-tech"],
  ["/api/jobs?roleCategory=FINANCE_ACCOUNTING&page=1", "synthetic-finance"],
  ["/api/jobs?roleCategory=MARKETING&page=1", "synthetic-general"],
]);
const server = http.createServer((request, response) => {
  const id = request.method === "GET" ? fixtureIds.get(request.url ?? "") : undefined;
  response.writeHead(id ? 200 : 404, { "content-type": "application/json" });
  response.end(JSON.stringify(id ? { data: [{ id, status: "LIVE" }], page: 1, pageSize: 20, total: 1, totalPages: 1, hasNextPage: false } : { error: "fixture_route_not_found" }));
});
const shutdown = () => { server.closeAllConnections(); server.close(); clearTimeout(timer); };
const timer = setTimeout(shutdown, 120_000);
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
server.on("error", () => { clearTimeout(timer); console.error("Fixture server could not bind loopback port 4319"); process.exitCode = 1; });
server.listen(4319, "127.0.0.1", () => console.error("Synthetic fixture: http://127.0.0.1:4319 (automatic stop after 120 seconds)"));

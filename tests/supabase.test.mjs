import test from "node:test";
import assert from "node:assert/strict";
import { getSeasonArchive, saveSeasonMatches } from "../js/supabase.js";

test("archive read uses one RPC response and surfaces setup/network errors", async (t) => {
  const archive = { matches: [], coverage_complete: false };
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.ok(url.endsWith("/rest/v1/rpc/get_season_archive"));
    assert.equal(options.method, "POST");
    assert.ok(options.signal instanceof AbortSignal);
    return Response.json(archive);
  });
  assert.deepEqual(await getSeasonArchive(), archive);
  globalThis.fetch = async () => Response.json({ message: "Archive not initialized" }, { status: 404 });
  await assert.rejects(getSeasonArchive(), { message: "Archive not initialized", status: 404 });
});

test("background save uses the restricted RPC and skips an empty batch", async (t) => {
  let calls = 0;
  const rows = [{ id: "known-new-game" }];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls++;
    assert.ok(url.endsWith("/rest/v1/rpc/archive_season_matches"));
    assert.equal(options.method, "POST");
    assert.deepEqual(JSON.parse(options.body), { p_matches: rows });
    return Response.json(1);
  });
  assert.equal(await saveSeasonMatches([]), 0);
  assert.equal(calls, 0);
  assert.equal(await saveSeasonMatches(rows), 1);
  assert.equal(calls, 1);
});

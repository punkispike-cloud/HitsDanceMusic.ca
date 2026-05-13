/* Tests : store wrapper localStorage avec tolérance mode privé Safari.
   Run : node --test tests/store.test.mjs */

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

// Mock localStorage AVANT d'importer le module (qui le résout au runtime).
class LocalStorageMock {
  constructor() { this._data = new Map(); this._throwOnGet = false; this._throwOnSet = false; }
  getItem(k) {
    if (this._throwOnGet) throw new Error("QuotaExceededError");
    return this._data.has(k) ? this._data.get(k) : null;
  }
  setItem(k, v) {
    if (this._throwOnSet) throw new Error("QuotaExceededError");
    this._data.set(k, String(v));
  }
  removeItem(k) { this._data.delete(k); }
  clear() { this._data.clear(); }
}

const ls = new LocalStorageMock();
globalThis.localStorage = ls;

const { store, STORAGE } = await import("../js/store.js");

beforeEach(() => {
  ls._data.clear();
  ls._throwOnGet = false;
  ls._throwOnSet = false;
});

test("STORAGE — toutes les clés sont préfixées 'hr.'", () => {
  for (const k of Object.values(STORAGE)) {
    assert.match(k, /^hr\./, `${k} pas préfixée`);
  }
});

test("get / set strings", () => {
  store.set("test1", "abc");
  assert.equal(store.get("test1"), "abc");
});

test("get — fallback retourné si clé absente", () => {
  assert.equal(store.get("absent", "default"), "default");
});

test("get — fallback null par défaut", () => {
  assert.equal(store.get("absent"), null);
});

test("setJSON / getJSON — round-trip objet", () => {
  const obj = { artist: "Tiesto", count: 42, nested: { a: 1 } };
  store.setJSON("test_json", obj);
  assert.deepEqual(store.getJSON("test_json", null), obj);
});

test("getJSON — fallback retourné si JSON corrompu", () => {
  ls._data.set("corrupt", "{not valid json");
  assert.deepEqual(store.getJSON("corrupt", { ok: true }), { ok: true });
});

test("get — fallback si localStorage throw (mode privé Safari)", () => {
  ls._throwOnGet = true;
  assert.equal(store.get("anything", "fallback"), "fallback");
});

test("set — n'explose pas si localStorage throw (silencieux)", () => {
  ls._throwOnSet = true;
  assert.doesNotThrow(() => store.set("anything", "value"));
});

test("setJSON — n'explose pas si localStorage throw", () => {
  ls._throwOnSet = true;
  assert.doesNotThrow(() => store.setJSON("anything", { a: 1 }));
});

test("set convertit en string (coercion safety)", () => {
  store.set("num", 42);
  assert.equal(store.get("num"), "42");
  store.set("bool", true);
  assert.equal(store.get("bool"), "true");
});

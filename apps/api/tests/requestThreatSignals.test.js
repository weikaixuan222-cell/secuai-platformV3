import assert from "node:assert/strict";
import test from "node:test";

import {
  findThreatSignalMatch,
  normalizeThreatSignalValue,
  SQLI_RULE_TOKENS,
  XSS_RULE_TOKENS
} from "../dist/services/requestThreatSignals.js";

test("normalizeThreatSignalValue normalizes queryString plus signs, single-pass URL encoding, and lowercase", () => {
  assert.equal(
    normalizeThreatSignalValue({
      name: "queryString",
      value: "q=UnIoN+SeLeCt"
    }),
    "q=union select"
  );

  assert.equal(
    normalizeThreatSignalValue({
      name: "queryString",
      value: "q=%3CSCRIPT%3Ealert%281%29%3C%2FSCRIPT%3E"
    }),
    "q=<script>alert(1)</script>"
  );
});

test("normalizeThreatSignalValue decodes path/queryString at most twice and safely falls back on malformed percent escapes", () => {
  assert.equal(
    normalizeThreatSignalValue({
      name: "path",
      value: "/search/%253Cscript%253Ealert%25281%2529%253C%252Fscript%253E"
    }),
    "/search/<script>alert(1)</script>"
  );

  assert.equal(
    normalizeThreatSignalValue({
      name: "path",
      value: "/login/%252575nion%252520select"
    }),
    "/login/%75nion%20select"
  );

  assert.equal(
    normalizeThreatSignalValue({
      name: "queryString",
      value: "next=%"
    }),
    "next=%"
  );

  assert.equal(
    normalizeThreatSignalValue({
      name: "path",
      value: "/files/%E0%A4%A"
    }),
    "/files/%e0%a4%a"
  );
});

test("findThreatSignalMatch detects encoded path SQLi/XSS payloads and avoids obvious benign false positives", () => {
  assert.deepEqual(
    findThreatSignalMatch(
      [
        {
          name: "path",
          value: "/login/%2555nion%2520SeLeCt"
        }
      ],
      SQLI_RULE_TOKENS
    ),
    {
      field: "path",
      token: "union select",
      matchedTokens: ["union select"]
    }
  );

  assert.deepEqual(
    findThreatSignalMatch(
      [
        {
          name: "path",
          value: "/search/%253Cscript%253Ealert%25281%2529%253C%252Fscript%253E"
        }
      ],
      XSS_RULE_TOKENS
    ),
    {
      field: "path",
      token: "<script",
      matchedTokens: ["<script", "alert("]
    }
  );

  assert.equal(
    findThreatSignalMatch(
      [
        {
          name: "path",
          value: "/docs/unionized-selection"
        },
        {
          name: "queryString",
          value: "topic=javascript-guide"
        }
      ],
      SQLI_RULE_TOKENS
    ),
    null
  );

  assert.equal(
    findThreatSignalMatch(
      [
        {
          name: "path",
          value: "/docs/unionized-selection"
        },
        {
          name: "queryString",
          value: "topic=javascript-guide"
        }
      ],
      XSS_RULE_TOKENS
    ),
    null
  );
});

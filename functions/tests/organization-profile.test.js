const test = require("node:test");
const assert = require("node:assert/strict");

const {
  getBootstrapOrganizationName,
} = require("../lib/functions/organization-profile.js");

test("uses the provided organization name when supplied", () => {
  assert.equal(
    getBootstrapOrganizationName("  Acme Auto Finance  ", "Ankit Narsi"),
    "Acme Auto Finance",
  );
});

test("falls back to display name when organization name is missing", () => {
  assert.equal(
    getBootstrapOrganizationName("", "Ankit Narsi"),
    "Ankit Narsi's Organization",
  );
});

test("falls back to default organization name when both names are blank", () => {
  assert.equal(
    getBootstrapOrganizationName("   ", "   "),
    "My Organization",
  );
});
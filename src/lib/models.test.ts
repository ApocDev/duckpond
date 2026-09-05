import { expect, it } from "vite-plus/test";
import { defaults } from "./room";
import { findModel, validateModelSelection, type ModelCatalog } from "./models";

const catalog: ModelCatalog = {
  provider: "claude",
  models: [
    {
      id: "example",
      name: "Example",
      description: "",
      aliases: ["example-version"],
      reasoning: ["low", "medium"],
    },
    { id: "quick", name: "Quick", description: "", aliases: [], reasoning: [] },
  ],
};
it("matches explicit model versions and checks effort against that model", () => {
  expect(findModel(catalog.models, "example-version")?.id).toBe("example");
  expect(() =>
    validateModelSelection({ ...defaults[0], model: "example-version", reasoning: "low" }, catalog),
  ).not.toThrow();
  expect(() =>
    validateModelSelection({ ...defaults[0], model: "example", reasoning: "ultra" }, catalog),
  ).toThrow("does not support");
  expect(() =>
    validateModelSelection({ ...defaults[0], model: "quick", reasoning: "low" }, catalog),
  ).toThrow("does not support");
});
it("does not invent choices when discovery fails, but permits account defaults", () => {
  const failed = { ...catalog, models: [], error: "Discovery unavailable" };
  expect(() => validateModelSelection({ ...defaults[0], model: "example" }, failed)).toThrow(
    "Discovery unavailable",
  );
  expect(() => validateModelSelection({ ...defaults[0], model: "" }, failed)).not.toThrow();
});

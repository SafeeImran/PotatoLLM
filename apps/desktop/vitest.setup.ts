import "@testing-library/jest-dom/vitest";

// jsdom has no canvas implementation, so every render of the Playground's idle
// Lorenz backdrop logs a "Not implemented: getContext" error. The component
// already handles a null context by doing nothing; this just keeps that from
// filling the test output with noise about a case we support on purpose.
HTMLCanvasElement.prototype.getContext = (() => null) as HTMLCanvasElement["getContext"];

import { describe, it, expect } from "vitest";
import { LogBuffer } from "../logbuf/index.js";

describe("LogBuffer", () => {
  it("writes and reads lines", () => {
    const buf = new LogBuffer(10);
    buf.write("line 1");
    buf.write("line 2");
    expect(buf.getLines()).toEqual(["line 1", "line 2"]);
  });

  it("wraps around when capacity is exceeded", () => {
    const buf = new LogBuffer(3);
    buf.write("a");
    buf.write("b");
    buf.write("c");
    buf.write("d"); // overwrites "a"
    const lines = buf.getLines();
    expect(lines).toEqual(["b", "c", "d"]);
  });

  it("getLines with limit returns the last n lines", () => {
    const buf = new LogBuffer(10);
    buf.write("one");
    buf.write("two");
    buf.write("three");
    buf.write("four");
    expect(buf.getLines(2)).toEqual(["three", "four"]);
  });

  it("getLines with limit after wrapping returns correct lines", () => {
    const buf = new LogBuffer(3);
    buf.write("a");
    buf.write("b");
    buf.write("c");
    buf.write("d");
    buf.write("e"); // buffer: [d, e, c] with pos=2
    expect(buf.getLines(2)).toEqual(["d", "e"]);
  });

  it("empty buffer returns empty array", () => {
    const buf = new LogBuffer(5);
    expect(buf.getLines()).toEqual([]);
    expect(buf.getLines(10)).toEqual([]);
  });

  it("handles multi-line write", () => {
    const buf = new LogBuffer(10);
    buf.write("line1\nline2\nline3");
    expect(buf.getLines()).toEqual(["line1", "line2", "line3"]);
  });

  it("skips empty lines in multi-line write", () => {
    const buf = new LogBuffer(10);
    buf.write("a\n\nb\n");
    expect(buf.getLines()).toEqual(["a", "b"]);
  });

  it("getLines returns all when limit exceeds count", () => {
    const buf = new LogBuffer(10);
    buf.write("x");
    buf.write("y");
    expect(buf.getLines(100)).toEqual(["x", "y"]);
  });
});

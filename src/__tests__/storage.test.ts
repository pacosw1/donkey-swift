import { describe, expect, it, vi } from "vitest";
import { ValidationError } from "../errors/index.js";
import {
  StorageUploadService,
  buildStorageObjectKey,
  type StorageProvider,
} from "../storage/index.js";

function mockStorageProvider(configured = true): StorageProvider {
  return {
    configured: vi.fn().mockReturnValue(configured),
    put: vi.fn().mockResolvedValue(undefined),
    get: vi.fn(),
  };
}

describe("storage", () => {
  it("builds sanitized object keys", () => {
    const key = buildStorageObjectKey("support-chat/images", "Family Photo!!.JPG", "image/jpeg");
    expect(key).toMatch(
      /^support-chat\/images\/family-photo-[0-9a-f-]+\.JPG$/i,
    );
  });

  it("uploads validated objects", async () => {
    const storage = mockStorageProvider();
    const service = new StorageUploadService(storage);

    const result = await service.uploadObject({
      keyPrefix: "support-chat/images",
      fileName: "note.png",
      contentType: "image/png",
      data: new Uint8Array([1, 2, 3]),
      allowedContentTypes: ["image/*"],
      maxBytes: 10,
    });

    expect(result.key).toMatch(/^support-chat\/images\/note-[0-9a-f-]+\.png$/);
    expect(result.contentType).toBe("image/png");
    expect(result.sizeBytes).toBe(3);
    expect(storage.put).toHaveBeenCalledOnce();
  });

  it("rejects unsupported content types", async () => {
    const service = new StorageUploadService(mockStorageProvider());

    await expect(
      service.uploadObject({
        keyPrefix: "support-chat/uploads",
        fileName: "video.mov",
        contentType: "video/quicktime",
        data: new Uint8Array([1, 2, 3]),
        allowedContentTypes: ["image/*"],
      }),
    ).rejects.toThrow(ValidationError);
  });

  it("rejects uploads when storage is not configured", async () => {
    const service = new StorageUploadService(mockStorageProvider(false));

    await expect(
      service.uploadObject({
        keyPrefix: "support-chat/uploads",
        contentType: "image/jpeg",
        data: new Uint8Array([1]),
      }),
    ).rejects.toThrow(/storage not configured/i);
  });
});

"use client";

import type { ShopPhoto } from "@daybell/api";
import { ProtectedImage } from "./protected-image";

/** The gallery's grid: each photo opens the full-screen viewer. Photos are the only colour (D116). */
export function PhotoGrid({
  photos,
  alt,
  onOpen,
  onImageError,
}: {
  photos: ShopPhoto[];
  alt: (n: number, total: number) => string;
  onOpen: (index: number) => void;
  onImageError: () => void;
}) {
  return (
    <ul className="m-0 mt-4 grid list-none grid-cols-2 gap-2 p-0">
      {photos.map((photo, index) => (
        <li key={photo.id}>
          <button
            type="button"
            onClick={() => onOpen(index)}
            className="block aspect-[4/5] w-full overflow-hidden rounded-md bg-subtle p-0 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-studio-ring"
          >
            <ProtectedImage
              src={photo.thumbUrl}
              alt={alt(index + 1, photos.length)}
              onError={onImageError}
            />
          </button>
        </li>
      ))}
    </ul>
  );
}

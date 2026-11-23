/** Body areas and angles a clinical photo can show (labels in messages: photos.areas / photos.views). */
export const PHOTO_AREAS = [
  "face",
  "forehead",
  "cheeks",
  "nose",
  "chin",
  "eyes",
  "lips",
  "neck",
  "scalp",
  "chest",
  "back",
  "abdomen",
  "arms",
  "hands",
  "legs",
  "other",
] as const;
export const PHOTO_VIEWS = ["front", "left", "right", "close_up"] as const;

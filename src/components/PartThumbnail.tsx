import type { PartCategory } from "../types/index.js";

export function PartThumbnail({
  color,
  category = "Brick",
  small = false,
}: {
  color: string;
  category?: PartCategory;
  small?: boolean;
}) {
  const thin = category === "Plate" || category === "Tile";
  const bottom = thin ? 39 : 49;
  return (
    <svg
      className={`part-thumbnail ${small ? "small" : ""}`}
      viewBox="0 0 64 60"
      aria-hidden="true"
    >
      <ellipse cx="33" cy="51" rx="24" ry="4" fill="#273c2420" />
      <path d={`M8 25 32 13 56 25 32 37Z`} fill={color} />
      <path d={`M8 25 32 37 32 ${bottom + 5} 8 ${bottom - 7}Z`} fill={color} />
      <path
        d={`M32 37 56 25 56 ${bottom - 7} 32 ${bottom + 5}Z`}
        fill={color}
      />
      <path
        d={`M8 25 32 37 32 ${bottom + 5} 8 ${bottom - 7}Z`}
        fill="#ffffff18"
      />
      <path
        d={`M32 37 56 25 56 ${bottom - 7} 32 ${bottom + 5}Z`}
        fill="#00000020"
      />
      {category !== "Tile" &&
        [0, 1].map((i) => (
          <g key={i}>
            <path d={`M${20 + i * 15} ${21 + i * 7}v-5h10v5`} fill={color} />
            <ellipse
              cx={25 + i * 15}
              cy={16 + i * 7}
              rx="6"
              ry="3"
              fill={color}
              stroke="#ffffff50"
              strokeWidth="1"
            />
          </g>
        ))}
    </svg>
  );
}

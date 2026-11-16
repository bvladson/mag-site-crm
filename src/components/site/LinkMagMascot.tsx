/**
 * Mascote MAG (nome provisório) — cadeira de escritório antropomórfica, SVG original.
 * Decorativo: aria-hidden e pointer-events none. Animações via CSS (styles.css),
 * desligadas por prefers-reduced-motion.
 */
export type LinkMascotPose = "wave" | "point" | "peek" | "celebrate";

const RIGHT_ARM: Record<LinkMascotPose, string> = {
  wave: "M150 112 C172 100 178 80 176 62",
  point: "M150 112 C170 112 186 108 198 104",
  peek: "M150 100 C166 92 170 84 168 76",
  celebrate: "M150 108 C170 92 176 70 172 50",
};
const RIGHT_HAND: Record<LinkMascotPose, [number, number]> = {
  wave: [176, 56],
  point: [202, 103],
  peek: [168, 72],
  celebrate: [171, 44],
};
const LEFT_ARM: Record<LinkMascotPose, string> = {
  wave: "M50 112 C34 120 30 134 34 146",
  point: "M50 112 C34 120 30 134 34 146",
  peek: "M50 100 C34 92 30 84 32 76",
  celebrate: "M50 108 C30 92 24 70 28 50",
};
const LEFT_HAND: Record<LinkMascotPose, [number, number]> = {
  wave: [35, 150],
  point: [35, 150],
  peek: [32, 72],
  celebrate: [29, 44],
};

export function LinkMagMascot({
  pose = "wave",
  size = 160,
  className = "",
  animated = true,
}: {
  pose?: LinkMascotPose;
  size?: number;
  className?: string;
  animated?: boolean;
}) {
  const [rx, ry] = RIGHT_HAND[pose];
  const [lx, ly] = LEFT_HAND[pose];
  return (
    <svg
      viewBox="0 0 210 250"
      width={size}
      height={(size * 250) / 210}
      aria-hidden="true"
      focusable="false"
      data-testid="mag-mascot"
      data-pose={pose}
      className={`links-mascot ${animated ? "links-mascot-animated" : ""} links-mascot-pose-${pose} ${className}`}
    >
      <ellipse cx="100" cy="242" rx="58" ry="6" fill="oklch(0 0 0 / .18)" />
      <g className="links-mascot-body">
        {/* pernas / rodízios */}
        <rect
          x="93"
          y="160"
          width="14"
          height="40"
          rx="5"
          fill="var(--links-mascot-graphite)"
        />
        <path
          d="M100 196 L66 222 M100 196 L134 222"
          stroke="var(--links-mascot-graphite)"
          strokeWidth="10"
          strokeLinecap="round"
        />
        <g>
          <path
            d="M50 222 h30 a8 8 0 0 1 8 8 v2 H46 v-4 a6 6 0 0 1 4 -6z"
            fill="var(--links-accent)"
          />
          <rect
            x="46"
            y="230"
            width="42"
            height="5"
            rx="2.5"
            fill="var(--links-mascot-white)"
          />
          <path
            d="M120 222 h30 a6 6 0 0 1 4 6 v4 H112 v-2 a8 8 0 0 1 8 -8z"
            fill="var(--links-accent)"
          />
          <rect
            x="112"
            y="230"
            width="42"
            height="5"
            rx="2.5"
            fill="var(--links-mascot-white)"
          />
        </g>
        {/* assento */}
        <rect
          x="38"
          y="140"
          width="124"
          height="28"
          rx="14"
          fill="var(--links-mascot-graphite)"
        />
        <rect
          x="46"
          y="144"
          width="108"
          height="6"
          rx="3"
          fill="oklch(1 0 0 / .12)"
        />
        {/* braço esquerdo */}
        <g className="links-mascot-arm-l">
          <path
            d={LEFT_ARM[pose]}
            stroke="var(--links-mascot-graphite)"
            strokeWidth="9"
            fill="none"
            strokeLinecap="round"
          />
          <circle
            cx={lx}
            cy={ly}
            r="10"
            fill="var(--links-mascot-white)"
            stroke="var(--links-mascot-graphite)"
            strokeWidth="3"
          />
        </g>
        {/* encosto */}
        <rect
          x="50"
          y="18"
          width="100"
          height="128"
          rx="42"
          fill="var(--links-accent)"
        />
        <rect
          x="60"
          y="26"
          width="80"
          height="20"
          rx="10"
          fill="oklch(1 0 0 / .14)"
        />
        <path
          d="M58 120 q42 26 84 0"
          stroke="var(--links-mascot-deep)"
          strokeWidth="4"
          fill="none"
          opacity=".5"
        />
        {/* olhos */}
        <g className="links-mascot-eye">
          <ellipse cx="82" cy="70" rx="13" ry="16" fill="white" />
          <ellipse
            cx="85"
            cy="73"
            rx="6"
            ry="7.5"
            fill="var(--links-mascot-graphite)"
          />
          <circle cx="87" cy="69" r="2.2" fill="white" />
        </g>
        <g className="links-mascot-eye">
          <ellipse cx="118" cy="70" rx="13" ry="16" fill="white" />
          <ellipse
            cx="121"
            cy="73"
            rx="6"
            ry="7.5"
            fill="var(--links-mascot-graphite)"
          />
          <circle cx="123" cy="69" r="2.2" fill="white" />
        </g>
        <path
          d="M88 96 q12 10 24 0"
          stroke="var(--links-mascot-graphite)"
          strokeWidth="4"
          fill="none"
          strokeLinecap="round"
        />
        {/* badge MAG */}
        <rect
          x="80"
          y="110"
          width="40"
          height="16"
          rx="8"
          fill="var(--links-mascot-graphite)"
        />
        <text
          x="100"
          y="122"
          textAnchor="middle"
          fontSize="11"
          fontWeight="800"
          fill="white"
          fontFamily="Barlow Condensed, sans-serif"
          letterSpacing="1"
        >
          MAG
        </text>
        {/* braço direito */}
        <g className="links-mascot-arm-r">
          <path
            d={RIGHT_ARM[pose]}
            stroke="var(--links-mascot-graphite)"
            strokeWidth="9"
            fill="none"
            strokeLinecap="round"
          />
          <circle
            cx={rx}
            cy={ry}
            r="10"
            fill="var(--links-mascot-white)"
            stroke="var(--links-mascot-graphite)"
            strokeWidth="3"
          />
        </g>
      </g>
    </svg>
  );
}

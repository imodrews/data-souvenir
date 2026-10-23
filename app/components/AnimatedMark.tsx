"use client";

import { useState } from "react";


type AnimatedMarkProps = {
  x: number;
  y: number;
  size?: number;
};

export default function AnimatedMark({
  x,
  y,
  size = 80,
}: AnimatedMarkProps) {
  const [isPulsing, setIsPulsing] = useState(false);

  return (
  <g
    onClick={() => {
      setIsPulsing(true);

      window.setTimeout(() => {
        setIsPulsing(false);
      }, 500);
    }}
    style={{
      cursor: "pointer",
      transformBox: "fill-box",
      transformOrigin: "center",
      transform: isPulsing ? "scale(1.25)" : "scale(1)",
      transition: "transform 500ms ease-out",
    }}
  >
    <image
      href="/correct_color.png"
      x={x - size / 2}
      y={y - size / 2}
      width={size}
      height={size}
      className="artwork-dot"
    />
  </g>
);
}
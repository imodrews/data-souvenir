"use client";

import { useEffect, useState } from "react";

type AnimatedMarkProps = {
  x: number;
  y: number;
  size?: number;
};

const frames = [
  "/marks/red/1.png",
  "/marks/red/2.png",
  "/marks/red/3.png",

];

export default function AnimatedMark({
  x,
  y,
  size = 80,
}: AnimatedMarkProps) {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    if (frame >= frames.length - 1) {
      return;
    }

    const timer = setTimeout(() => {
      setFrame((current) => current + 1);
    }, 120);

    return () => clearTimeout(timer);
  }, [frame]);

  return (
    <image
      href={frames[frame]}
      x={x - size / 2}
      y={y - size / 2}
      width={size}
      height={size}
    />
  );
}
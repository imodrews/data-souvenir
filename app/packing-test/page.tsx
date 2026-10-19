
"use client";

import { useEffect, useRef } from "react";
import * as d3 from "d3";

type ExhibitionNode = {
  name: string;
  value?: number;
  children?: ExhibitionNode[];
};

type PackedNode = d3.HierarchyCircularNode<ExhibitionNode>;

const WIDTH = 928;
const HEIGHT = 928;

// Your static Procreate mark
const MARK_IMAGE = "/marks/red/3.png";

export default function PackingTestPage() {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!svgRef.current) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    let disposed = false;

    async function drawChart() {
      // 1. Load the exhibition hierarchy
      const data = await d3.json<ExhibitionNode>(
        "/exhibition-hierarchy.json"
      );

      if (!data || disposed) return;

      // 2. Calculate the packing layout
      const root = d3
        .pack<ExhibitionNode>()
        .size([WIDTH, HEIGHT])
        .padding(3)(
          d3
            .hierarchy(data)
            .sum((d) => d.value ?? 0)
            .sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
        );

      // 3. Set up the SVG
      svg
        .attr(
          "viewBox",
          `${-WIDTH / 2} ${-HEIGHT / 2} ${WIDTH} ${HEIGHT}`
        )
        .style("background", "#f7f6f2")
        .style("cursor", "pointer");

      // 4. Invisible circles for hierarchy navigation
      const node = svg
        .append("g")
        .selectAll<SVGCircleElement, PackedNode>("circle")
        .data(root.descendants().slice(1))
        .join("circle")
        .attr("fill", "transparent")
        .attr("stroke", "none")
        .attr("pointer-events", (d) =>
          d.children ? "all" : "none"
        )
        .on("click", (event, d) => {
          if (focus !== d) {
            zoom(event, d);
            event.stopPropagation();
          }
        });

      // 5. Add your handmade marks to artwork nodes
      const marks = svg
        .append("g")
        .attr("pointer-events", "none")
        .selectAll<SVGImageElement, PackedNode>("image")
        .data(root.leaves())
        .join("image")
        .attr("href", MARK_IMAGE)
        .attr("preserveAspectRatio", "xMidYMid meet");

      // 6. Text labels
      const label = svg
        .append("g")
        .style("font", "14px sans-serif")
        .attr("fill", "#222")
        .attr("pointer-events", "none")
        .attr("text-anchor", "middle")
        .selectAll<SVGTextElement, PackedNode>("text")
        .data(root.descendants())
        .join("text")
        .style("fill-opacity", (d) =>
          d.parent === root ? 1 : 0
        )
        .style("display", (d) =>
          d.parent === root ? "inline" : "none"
        )
        .text((d) => d.data.name);

      // 7. Initial zoom
      let focus: PackedNode = root;

      let view: [number, number, number] = [
        root.x,
        root.y,
        root.r * 2,
      ];

      // 8. Position all elements during zoom
      function zoomTo(v: [number, number, number]) {
        const k = WIDTH / v[2];
        view = v;

        // Position labels
        label.attr(
          "transform",
          (d) =>
            `translate(${(d.x - v[0]) * k},${(d.y - v[1]) * k})`
        );

        // Position invisible circles
        node
          .attr(
            "transform",
            (d) =>
              `translate(${(d.x - v[0]) * k},${(d.y - v[1]) * k})`
          )
          .attr("r", (d) => d.r * k);

        // Position and scale your marks
        marks
          .attr(
            "x",
            (d) => (d.x - v[0]) * k - d.r * k
          )
          .attr(
            "y",
            (d) => (d.y - v[1]) * k - d.r * k
          )
          .attr("width", (d) => d.r * 2 * k)
          .attr("height", (d) => d.r * 2 * k);
      }

      // 9. Animated zoom between hierarchy levels
      function zoom(event: MouseEvent, d: PackedNode) {
        focus = d;

        const duration = event.altKey ? 7500 : 750;

        svg
          .transition()
          .duration(duration)
          .tween("zoom", () => {
            const interpolate = d3.interpolateZoom(
              view,
              [focus.x, focus.y, focus.r * 2]
            );

            return (t) => {
              zoomTo(
                interpolate(t) as [number, number, number]
              );
            };
          });

        // Show labels belonging to the focused node
        label
          .filter(function (d) {
            return (
              d.parent === focus ||
              this.style.display === "inline"
            );
          })
          .transition()
          .duration(duration)
          .style("fill-opacity", (d) =>
            d.parent === focus ? 1 : 0
          )
          .on("start", function (d) {
            if (d.parent === focus) {
              this.style.display = "inline";
            }
          })
          .on("end", function (d) {
            if (d.parent !== focus) {
              this.style.display = "none";
            }
          });
      }

      // 10. Click background to return to overview
      svg.on("click", (event) => {
        zoom(event, root);
      });

      // 11. Draw the initial view
      zoomTo(view);
    }

    drawChart().catch(console.error);

    return () => {
      disposed = true;
      svg.interrupt();
      svg.selectAll("*").interrupt();
      svg.on("click", null);
    };
  }, []);

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "#f3f2e6",
        padding: "40px 20px",
      }}
    >
      <h1
        style={{
          fontFamily: "serif",
          fontSize: "32px",
          fontWeight: 400,
          textAlign: "center",
          marginBottom: "24px",
          color: "#222",
        }}
      >
        Exhibition Constellation
      </h1>

      <svg
        ref={svgRef}
        width="100%"
        style={{
          maxWidth: "800px",
          height: "auto",
          display: "block",
          margin: "0 auto",
        }}
      />
    </main>
  );
}

import { ImageResponse } from "next/og";

export const size = { width: 64, height: 64 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 16,
          background: "#215E48",
          padding: 12,
          gap: 6,
        }}
      >
        <div
          style={{
            width: 16,
            height: 40,
            borderRadius: 6,
            background: "#F7F6F2",
          }}
        />
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            height: 40,
            width: 18,
          }}
        >
          <div
            style={{
              width: 16,
              height: 16,
              borderRadius: 999,
              background: "#F7F6F2",
            }}
          />
          <div
            style={{
              width: 18,
              height: 18,
              borderRadius: 5,
              background: "rgba(247,246,242,0.82)",
            }}
          />
        </div>
      </div>
    ),
    { ...size }
  );
}

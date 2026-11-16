import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#215E48",
          padding: 36,
          gap: 16,
        }}
      >
        <div
          style={{
            width: 44,
            height: 108,
            borderRadius: 16,
            background: "#F7F6F2",
          }}
        />
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            height: 108,
            width: 48,
          }}
        >
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 999,
              background: "#F7F6F2",
            }}
          />
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: 14,
              background: "rgba(247,246,242,0.82)",
            }}
          />
        </div>
      </div>
    ),
    { ...size }
  );
}

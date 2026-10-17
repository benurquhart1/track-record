"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";

export function QrCode({ value }: { value: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    QRCode.toDataURL(value, { margin: 1, width: 360 }).then(setSrc);
  }, [value]);
  // eslint-disable-next-line @next/next/no-img-element
  return src ? <img src={src} alt="Scan to join" className="mx-auto w-48 rounded-xl bg-white p-2" /> : null;
}

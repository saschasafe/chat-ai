import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Webcam or screen capture with frame grabbing.
 *
 * The stream is attached to a hidden <video> element, frames are pulled from it
 * on demand and returned as JPEG data URLs ready for the vision API.
 */
export function useMediaCapture({ onError } = {}) {
  const [source, setSource] = useState("camera"); // "camera" | "screen"
  const [deviceId, setDeviceId] = useState("");
  const [devices, setDevices] = useState([]);
  const [isActive, setIsActive] = useState(false);

  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const canvasRef = useRef(null);

  const onErrorRef = useRef(onError);
  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  // Labels are only exposed after permission was granted at least once
  const refreshDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      const cameras = all.filter((device) => device.kind === "videoinput");
      setDevices(cameras);
      return cameras;
    } catch (error) {
      onErrorRef.current?.(error);
      return [];
    }
  }, []);

  const stop = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setIsActive(false);
  }, []);

  const start = useCallback(
    async (nextSource = source, nextDeviceId = deviceId) => {
      const isSecureContext =
        window.isSecureContext ||
        location.protocol === "https:" ||
        location.hostname === "localhost";
      if (!isSecureContext) {
        onErrorRef.current?.(
          new Error("Camera and screen capture require HTTPS or localhost.")
        );
        return false;
      }

      stop();
      try {
        let stream;
        if (nextSource === "screen") {
          stream = await navigator.mediaDevices.getDisplayMedia({
            video: { frameRate: 5 },
            audio: false,
          });
          // The browser's own "stop sharing" control ends the track
          stream.getVideoTracks()[0]?.addEventListener("ended", () => stop());
        } else {
          stream = await navigator.mediaDevices.getUserMedia({
            video: nextDeviceId
              ? { deviceId: { exact: nextDeviceId } }
              : { facingMode: "user" },
            audio: false,
          });
        }

        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        setIsActive(true);
        setSource(nextSource);
        if (nextSource === "camera") {
          const cameras = await refreshDevices();
          if (!nextDeviceId) {
            const activeId = stream
              .getVideoTracks()[0]
              ?.getSettings?.()?.deviceId;
            if (activeId) setDeviceId(activeId);
            else if (cameras[0]?.deviceId) setDeviceId(cameras[0].deviceId);
          }
        }
        return true;
      } catch (error) {
        stop();
        onErrorRef.current?.(error);
        return false;
      }
    },
    [deviceId, refreshDevices, source, stop]
  );

  // Switching camera while running restarts the stream on the new device
  const selectDevice = useCallback(
    async (nextDeviceId) => {
      setDeviceId(nextDeviceId);
      if (isActive && source === "camera") {
        await start("camera", nextDeviceId);
      }
    },
    [isActive, source, start]
  );

  const selectSource = useCallback(
    async (nextSource) => {
      setSource(nextSource);
      if (isActive) {
        await start(nextSource, nextSource === "camera" ? deviceId : "");
      }
    },
    [deviceId, isActive, start]
  );

  // Grab the current video frame, downscaled, as a JPEG data URL
  const captureFrame = useCallback(({ maxWidth = 768, quality = 0.7 } = {}) => {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) return null;

    if (!canvasRef.current) canvasRef.current = document.createElement("canvas");
    const canvas = canvasRef.current;
    const scale = Math.min(1, maxWidth / video.videoWidth);
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);

    const context = canvas.getContext("2d");
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", quality);
  }, []);

  useEffect(() => {
    return () => stop();
  }, [stop]);

  return {
    videoRef,
    devices,
    deviceId,
    source,
    isActive,
    start,
    stop,
    selectDevice,
    selectSource,
    refreshDevices,
    captureFrame,
  };
}

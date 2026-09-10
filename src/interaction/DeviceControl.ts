import { useEffect, useRef } from "react";
import * as THREE from "three";

export function useDeviceControl() {
  const orientation = useRef(
    new THREE.Vector2(0, 0)
  );

  const motionAvailableRef =
    useRef(
      "DeviceOrientationEvent" in window
    );

  const motionEnabledRef =
    useRef(false);

  useEffect(() => {
    const handleOrientation = (
      event: DeviceOrientationEvent
    ) => {
      if (
        event.gamma === null ||
        event.beta === null
      ) {
        return;
      }

      const x =
        THREE.MathUtils.clamp(
          event.gamma / 35,
          -1,
          1
        );

      const y =
        THREE.MathUtils.clamp(
          (event.beta - 45) / 35,
          -1,
          1
        );

      orientation.current.set(
        x,
        y
      );
    };

    if (
      !motionAvailableRef.current
    ) {
      return;
    }

    window.addEventListener(
      "deviceorientation",
      handleOrientation
    );

    motionEnabledRef.current =
      true;

    return () => {
      window.removeEventListener(
        "deviceorientation",
        handleOrientation
      );
    };
  }, []);

  const enableMotion = async () => {
    try {
      const deviceEvent =
        DeviceOrientationEvent as typeof DeviceOrientationEvent & {
          requestPermission?: () => Promise<
            "granted" | "denied"
          >;
        };

      if (
        typeof deviceEvent.requestPermission ===
        "function"
      ) {
        const permission =
          await deviceEvent.requestPermission();

        if (permission !== "granted") {
          return false;
        }
      }

      motionEnabledRef.current =
        true;

      return true;
    } catch {
      return false;
    }
  };

  return {
    orientation,
    motionAvailable:
      motionAvailableRef.current,
    motionEnabled:
      motionEnabledRef.current,
    enableMotion,
  };
}

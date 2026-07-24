import { Aperture, Camera, Crop, Image, Scissors, type LucideIcon } from "lucide-react";

const PLUGIN_ICONS: Record<string, LucideIcon> = {
  crop: Crop,
  camera: Camera,
  scissors: Scissors,
  image: Image,
  aperture: Aperture,
};

export function pluginIcon(name: string): LucideIcon {
  return PLUGIN_ICONS[name] ?? Crop;
}

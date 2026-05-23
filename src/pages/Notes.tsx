import { usePlatform } from "@/contexts/PlatformContext";
import ChannelTab from "@/components/notes/ChannelTab";

export default function Notes() {
  const { platform } = usePlatform();

  return (
    <div className="max-w-5xl mx-auto px-3 sm:px-6 py-3 sm:py-6">
      <ChannelTab platform={platform} />
    </div>
  );
}

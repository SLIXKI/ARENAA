import React from 'react';
import { Layers, Terminal, Flame, Activity, Plug, Radar } from 'lucide-react';

export type TabId = 'dashboard' | 'tester' | 'quota' | 'telemetry' | 'export' | 'monitor';

interface MobileTabBarProps {
  activeTab: TabId;
  onSelectTab: (tab: TabId) => void;
  /** Unread/attention markers, so a tab can signal state without being opened. */
  badges?: Partial<Record<TabId, string | number>>;
}

const TABS: { id: TabId; label: string; Icon: typeof Layers; hint: string }[] = [
  { id: 'dashboard', label: 'Nodes', Icon: Layers, hint: 'Providers, endpoints and routing policy' },
  { id: 'tester', label: 'Tester', Icon: Terminal, hint: 'Send a real request through the gateway' },
  { id: 'quota', label: 'Quota', Icon: Flame, hint: 'Daily token burn and limits' },
  { id: 'telemetry', label: 'Metrics', Icon: Activity, hint: 'Latency, uptime and routing decisions' },
  { id: 'export', label: 'Connect', Icon: Plug, hint: 'Master key and client integrations' },
  { id: 'monitor', label: 'Keys', Icon: Radar, hint: 'Live health of every API key' },
];

/**
 * Thumb-reachable bottom navigation for phones.
 *
 * The previous mobile nav lived directly under the header, which on a 6.7" screen
 * means a two-handed stretch for the most-used control in the app. This is fixed to
 * the bottom, respects `env(safe-area-inset-bottom)` for notched/home-indicator
 * devices, keeps 44px+ tap targets, and is hidden from `sm:` up where the header
 * tabs take over.
 */
export const MobileTabBar: React.FC<MobileTabBarProps> = ({ activeTab, onSelectTab, badges }) => {
  return (
    <nav className="ui-tabbar sm:hidden" role="tablist" aria-label="Main sections">
      {TABS.map(({ id, label, Icon, hint }) => {
        const active = activeTab === id;
        const badge = badges?.[id];
        return (
          <button
            key={id}
            type="button"
            role="tab"
            className="ui-tabbar-item"
            data-active={active}
            aria-selected={active}
            aria-label={hint}
            title={hint}
            onClick={() => onSelectTab(id)}
          >
            <span className="relative flex items-center justify-center">
              <Icon className="h-[18px] w-[18px]" strokeWidth={active ? 2.4 : 1.9} aria-hidden="true" />
              {badge !== undefined && badge !== '' && (
                <span className="absolute -right-2 -top-1.5 min-w-[15px] rounded-full bg-rose-500 px-1 text-[9px] font-black leading-[15px] text-white shadow-[0_0_10px_rgba(244,63,94,0.7)]">
                  {badge}
                </span>
              )}
            </span>
            <span className="truncate">{label}</span>
          </button>
        );
      })}
    </nav>
  );
};

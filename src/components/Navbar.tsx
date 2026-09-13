import React, { useState, useEffect } from 'react';
import { 
  Server, 
  Activity, 
  Plus, 
  RefreshCw, 
  Layers, 
  Terminal, 
  Code2, 
  Check,
  ChevronDown,
  Flame,
  Plug,
  Bot,
  User,
  Key,
  Radar
} from 'lucide-react';
import { Provider } from '../types/router';

interface NavbarProps {
  providers: Provider[];
  activeProviderId: string;
  onSelectProvider: (providerId: string) => void;
  activeTab: 'dashboard' | 'tester' | 'quota' | 'telemetry' | 'export' | 'monitor';
  onSelectTab: (tab: 'dashboard' | 'tester' | 'quota' | 'telemetry' | 'export' | 'monitor') => void;
  onOpenAddEndpoint: () => void;
  onOpenAddProvider: () => void;
  onRunHealthSweep: () => void;
  isHealthSweeping: boolean;
  activeEndpointsCount: number;
  totalEndpointsCount: number;
  operatorUsername?: string;
  onOpenLogin: () => void;
  isCopilotOpen: boolean;
  onToggleCopilot: () => void;
  isWatchdogActive?: boolean;
  onToggleWatchdog?: () => void;
  bell?: React.ReactNode;
  onOpenKeys?: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  providers,
  activeProviderId,
  onSelectProvider,
  activeTab,
  onSelectTab,
  onOpenAddEndpoint,
  onOpenAddProvider,
  onRunHealthSweep,
  isHealthSweeping,
  activeEndpointsCount,
  totalEndpointsCount,
  operatorUsername,
  onOpenLogin,
  isCopilotOpen,
  onToggleCopilot,
  isWatchdogActive = true,
  onToggleWatchdog,
  bell,
  onOpenKeys,
}) => {
  const [isScrolled, setIsScrolled] = useState(false);
  const [providerDropdownOpen, setProviderDropdownOpen] = useState(false);
  const [providerSearch, setProviderSearch] = useState('');

  useEffect(() => {
    const handleScroll = () => {
      if (window.scrollY > 15) {
        setIsScrolled(true);
      } else {
        setIsScrolled(false);
      }
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const activeProvider = providers.find((p) => p.id === activeProviderId) || providers[0];

  return (
    <header
      id="main-navbar"
      className={`sticky top-0 z-50 w-full transition-all duration-250 ${
        isScrolled
          ? 'bg-neutral-950/85 backdrop-blur-xl border-b border-neutral-800 shadow-[0_4px_24px_rgba(0,0,0,0.5)]'
          : 'bg-neutral-950/60 backdrop-blur-md border-b border-neutral-800/60'
      }`}
    >
      <div className="max-w-7xl mx-auto px-2.5 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16 gap-1.5 sm:gap-4">
          {/* Logo & Identity */}
          <div className="flex items-center gap-1.5 sm:gap-3 min-w-0 flex-shrink">
            <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
              <span className="font-mono text-[11px] sm:text-xs font-bold tracking-widest bg-neutral-100 text-neutral-950 px-1.5 sm:px-2 py-0.5 sm:py-1 rounded-none border border-neutral-200 shadow-sm flex-shrink-0">
                [ER]
              </span>
              <div className="flex flex-col min-w-0">
                <span className="font-bold tracking-tight text-xs sm:text-sm text-neutral-100 uppercase font-mono whitespace-nowrap truncate">
                  EDGE ROUTER
                </span>
                <span className="text-[9px] sm:text-[10px] font-mono tracking-wider text-neutral-500 uppercase hidden md:block">
                  Multi-Region API Mesh
                </span>
              </div>
            </div>

            {/* Edge Sync Indicator */}
            <div className="hidden xl:flex items-center gap-2 px-2.5 py-1 rounded-none border border-neutral-800 bg-neutral-900/60 text-[11px] font-mono text-neutral-400 flex-shrink-0">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
              <span>EDGE SYNCED</span>
              <span className="text-neutral-600">|</span>
              <span className="text-neutral-300 font-semibold">{activeEndpointsCount}/{totalEndpointsCount} Nodes</span>
            </div>

            {/* Autonomous Watchdog Indicator */}
            <button
              type="button"
              onClick={onToggleWatchdog}
              title={`Autonomous Watchdog Self-Driving Engine is ${isWatchdogActive ? 'ACTIVE' : 'STANDBY'}. Click to toggle.`}
              className={`hidden lg:flex items-center gap-1.5 px-2 py-1 border text-[11px] font-mono transition-colors flex-shrink-0 ${
                isWatchdogActive
                  ? 'border-emerald-800/80 bg-emerald-950/50 text-emerald-300 hover:bg-emerald-900/50'
                  : 'border-neutral-800 bg-neutral-900/60 text-neutral-500 hover:text-neutral-300'
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${isWatchdogActive ? 'bg-emerald-400 animate-pulse' : 'bg-neutral-500'}`} />
              <span>SELF-HEAL: {isWatchdogActive ? 'ACTIVE' : 'STANDBY'}</span>
            </button>
          </div>

          {/* Provider Selector Dropdown */}
          <div className="relative flex-shrink-0">
            <button
              id="provider-selector-btn"
              onClick={() => setProviderDropdownOpen(!providerDropdownOpen)}
              className="flex items-center gap-1 sm:gap-2 px-1.5 sm:px-3 py-1.5 bg-neutral-900 hover:bg-neutral-850 border border-neutral-700 text-neutral-200 hover:text-white text-xs font-mono tracking-wide rounded-none transition-all duration-200 ease-out max-w-[95px] xs:max-w-[120px] sm:max-w-[200px]"
            >
              <span className="text-neutral-500 uppercase text-[10px] hidden md:inline">Provider:</span>
              <span className="font-semibold text-white truncate text-[11px] sm:text-xs">{activeProvider?.name}</span>
              <ChevronDown className={`w-3 h-3 sm:w-3.5 sm:h-3.5 text-neutral-400 flex-shrink-0 transition-transform duration-200 ease-out ${providerDropdownOpen ? 'rotate-180' : ''}`} />
            </button>

            {providerDropdownOpen && (
              <>
                {/* Backdrop overlay for clean touch-away on mobile and desktop */}
                <div
                  className="fixed inset-0 z-40 bg-black/60 backdrop-blur-[2px] sm:bg-transparent sm:backdrop-blur-none"
                  onClick={() => setProviderDropdownOpen(false)}
                />
                {/* Dropdown positioned securely on mobile (fixed left-3 right-3) so it never overflows off-screen */}
                <div className="fixed left-3 right-3 top-[64px] sm:absolute sm:left-0 sm:right-auto sm:top-full sm:mt-1.5 w-auto sm:w-96 bg-neutral-900 border border-neutral-700 shadow-2xl z-50 py-1 max-h-[78vh] overflow-y-auto">
                  <div className="px-3 py-2 text-[10px] font-mono text-neutral-400 border-b border-neutral-800 uppercase tracking-wider flex justify-between items-center bg-neutral-950/95 sticky top-0 z-10 backdrop-blur">
                    <div className="flex items-center gap-1.5">
                      <span className="font-bold text-neutral-200">API Providers ({providers.length})</span>
                      <span className="text-[9px] text-emerald-400 border border-emerald-800/60 bg-emerald-950/40 px-1">HIGH DAILY LIMITS</span>
                    </div>
                    <button
                      onClick={() => {
                        setProviderDropdownOpen(false);
                        onOpenAddProvider();
                      }}
                      className="text-neutral-200 hover:text-white flex items-center gap-1 text-[11px] font-semibold bg-neutral-800 hover:bg-neutral-700 px-2 py-0.5 border border-neutral-700 transition-colors"
                    >
                      <Plus className="w-3 h-3" /> New
                    </button>
                  </div>

                  {/* Fast Search input */}
                  <div className="p-2 border-b border-neutral-800 bg-neutral-950/80 sticky top-[37px] z-10 backdrop-blur">
                    <input
                      type="text"
                      value={providerSearch}
                      onChange={(e) => setProviderSearch(e.target.value)}
                      placeholder="Search provider or model..."
                      className="w-full bg-neutral-900 border border-neutral-800 px-2.5 py-1 text-xs text-neutral-200 placeholder-neutral-500 font-mono focus:border-neutral-500 focus:outline-none"
                    />
                  </div>

                  <div className="divide-y divide-neutral-850 py-1">
                    {providers
                      .filter((p) => {
                        if (!providerSearch.trim()) return true;
                        const query = providerSearch.toLowerCase();
                        return (
                          p.name.toLowerCase().includes(query) ||
                          p.dailyTokenQuota?.toLowerCase().includes(query) ||
                          p.models.some((m) => m.toLowerCase().includes(query))
                        );
                      })
                      .map((p) => (
                      <button
                        key={p.id}
                        onClick={() => {
                          onSelectProvider(p.id);
                          setProviderDropdownOpen(false);
                          setProviderSearch('');
                        }}
                        className={`w-full text-left px-3 py-2.5 text-xs font-mono flex items-center justify-between hover:bg-neutral-800 transition-colors duration-150 min-h-[46px] sm:min-h-0 ${
                          p.id === activeProviderId
                            ? 'bg-neutral-800 text-white font-semibold'
                            : 'text-neutral-300'
                        }`}
                      >
                        <div className="flex flex-col min-w-0 pr-2 space-y-1">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="truncate text-white text-xs sm:text-[13px] font-medium">{p.name}</span>
                            {p.dailyTokenQuota && (
                              <span className="text-[9px] font-mono font-normal text-emerald-400 bg-emerald-950/80 border border-emerald-800/80 px-1.5 py-0.2 whitespace-nowrap">
                                {p.dailyTokenQuota}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 text-[10px] text-neutral-400 font-sans">
                            <span>{p.category}</span>
                            <span>•</span>
                            <span className="text-neutral-500">{p.models.length} models</span>
                          </div>
                        </div>
                        {p.id === activeProviderId && <Check className="w-4 h-4 text-emerald-400 flex-shrink-0" />}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Desktop Tab Navigation */}
          <nav className="hidden lg:flex items-center gap-1 border border-neutral-800 bg-neutral-900/40 p-1 flex-shrink-0">
            <button
              id="nav-tab-dashboard"
              onClick={() => onSelectTab('dashboard')}
              className={`flex items-center gap-2 px-3 py-1.5 text-xs font-mono tracking-wide rounded-none transition-all duration-200 ease-out ${
                activeTab === 'dashboard'
                  ? 'bg-neutral-100 text-neutral-950 font-semibold shadow'
                  : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/60'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>NODES & BENTO</span>
            </button>

            <button
              id="nav-tab-tester"
              onClick={() => onSelectTab('tester')}
              className={`flex items-center gap-2 px-3 py-1.5 text-xs font-mono tracking-wide rounded-none transition-all duration-200 ease-out ${
                activeTab === 'tester'
                  ? 'bg-neutral-100 text-neutral-950 font-semibold shadow'
                  : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/60'
              }`}
            >
              <Terminal className="w-3.5 h-3.5" />
              <span>EDGE TESTER</span>
            </button>

            <button
              id="nav-tab-quota"
              onClick={() => onSelectTab('quota')}
              className={`flex items-center gap-2 px-3 py-1.5 text-xs font-mono tracking-wide rounded-none transition-all duration-200 ease-out ${
                activeTab === 'quota'
                  ? 'bg-neutral-100 text-neutral-950 font-semibold shadow'
                  : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/60'
              }`}
            >
              <Flame className="w-3.5 h-3.5 text-emerald-400" />
              <span>DAILY QUOTA &amp; BURN</span>
            </button>

            <button
              id="nav-tab-telemetry"
              onClick={() => onSelectTab('telemetry')}
              className={`flex items-center gap-2 px-3 py-1.5 text-xs font-mono tracking-wide rounded-none transition-all duration-200 ease-out ${
                activeTab === 'telemetry'
                  ? 'bg-neutral-100 text-neutral-950 font-semibold shadow'
                  : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/60'
              }`}
            >
              <Activity className="w-3.5 h-3.5" />
              <span>METRICS &amp; LOGS</span>
            </button>

            <button
              id="nav-tab-export"
              onClick={() => onSelectTab('export')}
              className={`flex items-center gap-2 px-3 py-1.5 text-xs font-mono tracking-wide rounded-none transition-all duration-200 ease-out ${
                activeTab === 'export'
                  ? 'bg-neutral-100 text-neutral-950 font-semibold shadow'
                  : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/60'
              }`}
            >
              <Plug className="w-3.5 h-3.5" />
              <span>CONNECT</span>
            </button>

            <button
              id="nav-tab-monitor"
              onClick={() => onSelectTab('monitor')}
              className={`flex items-center gap-2 px-3 py-1.5 text-xs font-mono tracking-wide rounded-none transition-all duration-200 ease-out ${
                activeTab === 'monitor'
                  ? 'bg-neutral-100 text-neutral-950 font-semibold shadow'
                  : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/60'
              }`}
            >
              <Radar className="w-3.5 h-3.5" />
              <span>API MONITOR</span>
            </button>
          </nav>

          {/* Action Buttons */}
          <div className="flex items-center gap-1 sm:gap-2 flex-shrink-0">
            {bell}
            {onOpenKeys && (
              <button
                id="btn-provider-keys"
                onClick={onOpenKeys}
                title="Provider Keys — har provider me unlimited keys"
                className="flex items-center justify-center gap-1.5 px-2 sm:px-2.5 py-1.5 h-8 sm:h-auto text-xs font-mono bg-neutral-900 border border-neutral-800 text-neutral-300 hover:text-white hover:border-neutral-600 transition-colors"
              >
                <Key className="w-3.5 h-3.5 text-emerald-400" />
                <span className="hidden md:inline font-bold">KEYS</span>
              </button>
            )}
            {/* Operator Auth Status */}
            <button
              id="btn-operator-auth"
              onClick={onOpenLogin}
              title={operatorUsername ? `Logged in as ${operatorUsername}. Click to configure.` : "Login with credentials & Gemini key"}
              className={`flex items-center justify-center gap-1.5 px-2 sm:px-2.5 py-1.5 h-8 sm:h-auto text-xs font-mono border transition-all duration-150 ${
                operatorUsername
                  ? 'bg-neutral-900 border-emerald-800/80 text-emerald-400 hover:border-emerald-600'
                  : 'bg-neutral-900 border-neutral-800 text-neutral-300 hover:text-white hover:border-neutral-700'
              }`}
            >
              <User className="w-3.5 h-3.5" />
              <span className="hidden md:inline font-bold">
                {operatorUsername ? `OP: ${operatorUsername}` : 'LOGIN'}
              </span>
              {operatorUsername && (
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              )}
            </button>

            {/* AI Copilot Button */}
            <button
              id="btn-toggle-copilot"
              onClick={onToggleCopilot}
              title="Open Autonomous AI Copilot & Voice"
              className={`flex items-center justify-center gap-1.5 px-2.5 sm:px-3 py-1.5 h-8 sm:h-auto text-xs font-mono font-bold transition-all duration-200 ${
                isCopilotOpen
                  ? 'bg-emerald-400 text-neutral-950 shadow-lg shadow-emerald-950/50'
                  : 'bg-neutral-900 hover:bg-neutral-850 text-neutral-200 border border-neutral-700 hover:border-neutral-500'
              }`}
            >
              <Bot className={`w-3.5 h-3.5 ${isCopilotOpen ? 'text-neutral-950' : 'text-emerald-400'}`} />
              <span className="hidden sm:inline">AI COPILOT</span>
              <span className="text-[9px] px-1 py-0.2 bg-emerald-950 text-emerald-400 border border-emerald-800/80 hidden lg:inline font-normal">
                AUTO
              </span>
            </button>

            <button
              id="btn-health-sweep"
              onClick={onRunHealthSweep}
              disabled={isHealthSweeping}
              title="Ping all endpoints for real-time edge latency"
              className="flex items-center justify-center gap-1 px-2 sm:px-2.5 py-1.5 h-8 sm:h-auto text-xs font-mono text-neutral-300 hover:text-white bg-neutral-900 hover:bg-neutral-850 border border-neutral-800 hover:border-neutral-700 rounded-none transition-all duration-200 ease-out disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isHealthSweeping ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">SWEEP PING</span>
            </button>

            <button
              id="btn-add-endpoint"
              onClick={onOpenAddEndpoint}
              title="Add Regional Node"
              className="flex items-center justify-center gap-1 px-2 sm:px-3 py-1.5 h-8 sm:h-auto text-xs font-mono font-semibold text-neutral-950 bg-neutral-100 hover:bg-white border border-neutral-300 rounded-none transition-all duration-200 ease-out shadow-sm"
            >
              <Plus className="w-3.5 h-3.5 flex-shrink-0" />
              <span className="hidden sm:inline">ADD NODE</span>
            </button>
          </div>
        </div>
      </div>

      {/* Mobile sub-nav with accessible touch targets (44px min height) */}
      <div className="lg:hidden grid grid-cols-6 border-t border-neutral-800 bg-neutral-950 text-[10px] font-mono w-full max-w-full overflow-hidden">
        <button
          onClick={() => onSelectTab('dashboard')}
          className={`flex flex-col items-center justify-center py-2 px-0.5 min-h-[44px] transition-colors w-full min-w-0 ${
            activeTab === 'dashboard'
              ? 'text-white bg-neutral-900 border-b-2 border-white font-bold'
              : 'text-neutral-400 hover:text-neutral-200'
          }`}
        >
          <Layers className="w-3.5 h-3.5 mb-0.5 flex-shrink-0" />
          <span className="truncate max-w-full text-center text-[10px]">NODES</span>
        </button>
        <button
          onClick={() => onSelectTab('tester')}
          className={`flex flex-col items-center justify-center py-2 px-0.5 min-h-[44px] transition-colors w-full min-w-0 ${
            activeTab === 'tester'
              ? 'text-white bg-neutral-900 border-b-2 border-white font-bold'
              : 'text-neutral-400 hover:text-neutral-200'
          }`}
        >
          <Terminal className="w-3.5 h-3.5 mb-0.5 flex-shrink-0" />
          <span className="truncate max-w-full text-center text-[10px]">TESTER</span>
        </button>
        <button
          onClick={() => onSelectTab('quota')}
          className={`flex flex-col items-center justify-center py-2 px-0.5 min-h-[44px] transition-colors w-full min-w-0 ${
            activeTab === 'quota'
              ? 'text-white bg-neutral-900 border-b-2 border-white font-bold'
              : 'text-neutral-400 hover:text-neutral-200'
          }`}
        >
          <Flame className="w-3.5 h-3.5 mb-0.5 text-emerald-400 flex-shrink-0" />
          <span className="truncate max-w-full text-center text-[10px]">QUOTA</span>
        </button>
        <button
          onClick={() => onSelectTab('telemetry')}
          className={`flex flex-col items-center justify-center py-2 px-0.5 min-h-[44px] transition-colors w-full min-w-0 ${
            activeTab === 'telemetry'
              ? 'text-white bg-neutral-900 border-b-2 border-white font-bold'
              : 'text-neutral-400 hover:text-neutral-200'
          }`}
        >
          <Activity className="w-3.5 h-3.5 mb-0.5 flex-shrink-0" />
          <span className="truncate max-w-full text-center text-[10px]">METRICS</span>
        </button>
        <button
          onClick={() => onSelectTab('export')}
          className={`flex flex-col items-center justify-center py-2 px-0.5 min-h-[44px] transition-colors w-full min-w-0 ${
            activeTab === 'export'
              ? 'text-white bg-neutral-900 border-b-2 border-white font-bold'
              : 'text-neutral-400 hover:text-neutral-200'
          }`}
        >
          <Plug className="w-3.5 h-3.5 mb-0.5 flex-shrink-0" />
          <span className="truncate max-w-full text-center text-[10px]">CONNECT</span>
        </button>
        <button
          onClick={() => onSelectTab('monitor')}
          className={`flex flex-col items-center justify-center py-2 px-0.5 min-h-[44px] transition-colors w-full min-w-0 ${
            activeTab === 'monitor'
              ? 'text-white bg-neutral-900 border-b-2 border-white font-bold'
              : 'text-neutral-400 hover:text-neutral-200'
          }`}
        >
          <Radar className="w-3.5 h-3.5 mb-0.5 flex-shrink-0" />
          <span className="truncate max-w-full text-center text-[10px]">MONITOR</span>
        </button>
      </div>
    </header>
  );
};

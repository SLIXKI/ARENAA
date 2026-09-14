/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { Navbar } from './components/Navbar';
import { BentoDashboard } from './components/BentoDashboard';
import { EdgeTester } from './components/EdgeTester';
import { DailyQuotaTracker } from './components/DailyQuotaTracker';
import { TelemetryView } from './components/TelemetryView';
import { ConnectHub } from './components/ConnectHub';
import { ApiMonitor } from './components/ApiMonitor';
import { EndpointModal } from './components/EndpointModal';
import { ProviderModal } from './components/ProviderModal';
import { OperatorLoginModal } from './components/OperatorLoginModal';
import { ProfileModal } from './components/ProfileModal';
import { ProviderKeysModal } from './components/ProviderKeysModal';
import { NotificationsBell } from './components/NotificationsBell';
import { Toasts } from './components/Toasts';
import { notify, subscribeNotifications, loadNotifications, saveNotifications, type AppNotification } from './utils/notify';
import { getAllProviderKeys, getProviderKeys, addProviderKey, migratePoolsToUniversal } from './utils/providerKeys';
import { runCatalogSync, CATALOG_INTERVAL_MS } from './utils/catalog';
import { AutonomousCopilot } from './components/AutonomousCopilot';
import { INITIAL_PROVIDERS, INITIAL_ENDPOINTS, INITIAL_FALLBACK_CHAIN, INITIAL_DAILY_USAGES } from './data/initialData';
import { Provider, Endpoint, RoutingPolicy, RoutingDecision, WatchdogEvent } from './types/router';
import { EdgeRouterEngine } from './services/edgeRouterEngine';
import { AutonomousWatchdogService } from './services/autonomousWatchdog';
import { getSessionUsername, setSession, clearSession, syncUserGeminiKey } from './utils/auth';
import { computeStats } from './utils/probe';

// Runs ONCE at module load — BEFORE any useState initializer reads localStorage.
// (Old code ran migration inside a later initializer, so stale provider lists won.)
function runDataMigrations() {
  try {
    if (localStorage.getItem('er_data_version') === 'v5-edgerouter') return;
    localStorage.removeItem('er_providers');
    localStorage.removeItem('er_endpoints');
    localStorage.removeItem('er_active_provider');
    try {
      localStorage.setItem('er_fallback_chain', JSON.stringify(INITIAL_FALLBACK_CHAIN));
    } catch { /* ignore */ }
    try {
      const n = migratePoolsToUniversal();
      if (n > 0) {
        try {
          notify('success', `Keys merged: ${n}`, 'Saari purani keys ab Edge Router pool me. Kuch dobara dalne ki zaroorat nahi.');
        } catch { /* ignore */ }
      }
    } catch { /* ignore */ }
    try {
      localStorage.setItem('er_data_version', 'v5-edgerouter');
    } catch { /* ignore */ }
  } catch { /* ignore */ }
}
runDataMigrations();

export default function App() {
  // Persistence in local edge cache with smart migration for new providers
  // NOTE: data migrations run at module level (runDataMigrations) so they
  // execute BEFORE any useState initializer reads localStorage.
  const [providers, setProviders] = useState<Provider[]>(() => {
    const saved = localStorage.getItem('er_providers');
    if (!saved) return INITIAL_PROVIDERS;
    try {
      const parsed: Provider[] = JSON.parse(saved);
      const existingIds = new Set(parsed.map((p) => p.id));
      const missingInitial = INITIAL_PROVIDERS.filter((p) => !existingIds.has(p.id));
      const updated = parsed.map((p) => {
        const init = INITIAL_PROVIDERS.find((ip) => ip.id === p.id);
        if (init && !p.isCustom) {
          return {
            ...p,
            dailyTokenQuota: init.dailyTokenQuota || p.dailyTokenQuota,
            models: Array.from(new Set([...init.models, ...p.models])),
          };
        }
        return p;
      });
      return [...updated, ...missingInitial];
    } catch {
      return INITIAL_PROVIDERS;
    }
  });

  const [activeProviderId, setActiveProviderId] = useState<string>(() => {
    const saved = localStorage.getItem('er_active_provider');
    return saved || INITIAL_PROVIDERS[0].id;
  });

  const [endpoints, setEndpoints] = useState<Endpoint[]>(() => {
    const saved = localStorage.getItem('er_endpoints');
    if (!saved) return INITIAL_ENDPOINTS;
    try {
      const parsed: Endpoint[] = JSON.parse(saved);
      const existingIds = new Set(parsed.map((e) => e.id));
      const missingEndpoints = INITIAL_ENDPOINTS.filter((e) => !existingIds.has(e.id));
      return [...parsed, ...missingEndpoints];
    } catch {
      return INITIAL_ENDPOINTS;
    }
  });

  const [routingPolicy, setRoutingPolicy] = useState<RoutingPolicy>(() => {
    const saved = localStorage.getItem('er_routing_policy');
    return (saved as RoutingPolicy) || 'failover-cascade';
  });

  const [recentDecisions, setRecentDecisions] = useState<RoutingDecision[]>(() => {
    const saved = localStorage.getItem('er_recent_decisions');
    if (saved) return JSON.parse(saved);
    // Seed initial decision logs
    return [
      {
        id: 'req_init_991',
        timestamp: Date.now() - 15000,
        providerId: 'prov-openai',
        providerName: 'OpenAI',
        selectedEndpointId: 'ep-oai-useast',
        selectedEndpointName: 'US-East Primary Gateway',
        selectedRegion: 'us-east-1',
        policyApplied: 'failover-cascade',
        latencyMs: 24,
        statusCode: 200,
        cached: false,
        failoverAttempted: false,
        promptSummary: 'Verify multi-region cluster status',
        responsePayload: '{"status":"ok","latency_ms":24,"edge_pop":"iad-1"}',
        tokensUsed: 45,
      },
      {
        id: 'req_init_990',
        timestamp: Date.now() - 45000,
        providerId: 'prov-openai',
        providerName: 'OpenAI',
        selectedEndpointId: 'ep-oai-uswest',
        selectedEndpointName: 'US-West Redundant Cluster',
        selectedRegion: 'us-west-2',
        policyApplied: 'failover-cascade',
        latencyMs: 38,
        statusCode: 200,
        cached: false,
        failoverAttempted: true,
        failoverReason: 'Primary node rate-limit threshold reached. Seamless regional failover.',
        promptSummary: 'Embedding query vector lookup',
        responsePayload: '{"status":"ok","latency_ms":38,"failover":true}',
        tokensUsed: 38,
      },
      {
        id: 'req_init_989',
        timestamp: Date.now() - 110000,
        providerId: 'prov-openai',
        providerName: 'OpenAI',
        selectedEndpointId: 'ep-oai-eucentral',
        selectedEndpointName: 'EU-Central Failover Node',
        selectedRegion: 'eu-central-1',
        policyApplied: 'lowest-latency',
        latencyMs: 1,
        statusCode: 200,
        cached: true,
        failoverAttempted: false,
        promptSummary: 'Ping from Frankfurt edge point of presence',
        responsePayload: '{"status":"ok","cached":true,"latency_ms":1}',
        tokensUsed: 12,
      },
    ];
  });

  const [fallbackChain, setFallbackChain] = useState<string[]>(() => {
    const saved = localStorage.getItem('er_fallback_chain');
    if (!saved) return INITIAL_FALLBACK_CHAIN;
    try {
      return JSON.parse(saved);
    } catch {
      return INITIAL_FALLBACK_CHAIN;
    }
  });

  const [dailyUsages, setDailyUsages] = useState<Record<string, {
    requestsUsed: number;
    requestsLimit: number;
    tokensUsed: number;
    tokensLimit: number;
    primaryUnit: 'requests' | 'tokens';
  }>>(() => {
    const saved = localStorage.getItem('er_daily_usages');
    if (!saved) return INITIAL_DAILY_USAGES;
    try {
      const parsed = JSON.parse(saved);
      return { ...INITIAL_DAILY_USAGES, ...parsed };
    } catch {
      return INITIAL_DAILY_USAGES;
    }
  });

  const [activeTab, setActiveTab] = useState<'dashboard' | 'tester' | 'quota' | 'telemetry' | 'export' | 'monitor'>('dashboard');
  const [isHealthSweeping, setIsHealthSweeping] = useState(false);
  const [isAddEndpointOpen, setIsAddEndpointOpen] = useState(false);
  const [editingEndpoint, setEditingEndpoint] = useState<Endpoint | null>(null);
  const [isAddProviderOpen, setIsAddProviderOpen] = useState(false);

  // Operator Authentication & Autonomous Copilot state (multi-provider, per-user keys, strict gate)
  const [loggedUser, setLoggedUser] = useState<string | null>(() => {
    try {
      return getSessionUsername();
    } catch {
      return null;
    }
  });
  const [operatorUsername, setOperatorUsername] = useState<string>(() => {
    return getSessionUsername() || localStorage.getItem('er_operator_username') || '';
  });
  const [userGeminiKey, setUserGeminiKey] = useState<string>(() => {
    try {
      const sess = getSessionUsername();
      if (sess) {
        const users = JSON.parse(localStorage.getItem('er_users') || '[]');
        const found = users.find((x: any) => x.username === sess);
        if (found?.geminiKey) return found.geminiKey;
      }
      return localStorage.getItem('er_gemini_key') || '';
    } catch {
      return '';
    }
  });
  const [isLoginOpen, setIsLoginOpen] = useState(() => {
    try {
      return !getSessionUsername();
    } catch {
      return true;
    }
  });
  const [isCopilotOpen, setIsCopilotOpen] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [isKeysOpen, setIsKeysOpen] = useState(false);

  // Notifications: manual actions + agent actions land here (persisted, capped at 50)
  const [notifications, setNotifications] = useState<AppNotification[]>(() => loadNotifications());
  const [toasts, setToasts] = useState<AppNotification[]>([]);

  useEffect(() => {
    const unsub = subscribeNotifications((n) => {
      setNotifications((prev) => {
        const next = [{ ...n }, ...prev].slice(0, 50);
        saveNotifications(next);
        return next;
      });
      setToasts((prev) => [...prev.slice(-2), n]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== n.id));
      }, 4000);
    });
    return unsub;
  }, []);

  const markAllNotifRead = () => {
    setNotifications((prev) => {
      const next = prev.map((n) => ({ ...n, read: true }));
      saveNotifications(next);
      return next;
    });
  };
  const clearNotifications = () => {
    setNotifications([]);
    saveNotifications([]);
  };
  const dismissNotification = (id: string) => {
    setNotifications((prev) => {
      const next = prev.filter((n) => n.id !== id);
      saveNotifications(next);
      return next;
    });
  };

  // Autonomous Self-Driving Watchdog State
  const [isWatchdogActive, setIsWatchdogActive] = useState<boolean>(() => {
    const saved = localStorage.getItem('er_watchdog_active');
    return saved !== null ? saved === 'true' : true;
  });

  const [watchdogLogs, setWatchdogLogs] = useState<WatchdogEvent[]>(() => {
    const saved = localStorage.getItem('er_watchdog_logs');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {}
    }
    return [
      {
        id: 'wd_init_1',
        timestamp: Date.now() - 40000,
        type: 'ping_sweep',
        title: 'Autonomous Mesh Initialized',
        description: 'Watchdog active on all global regions. Auto-cascade quota protection armed at 85%.',
        actionTaken: 'Autonomous monitoring loop engaged with 25s probe intervals.',
      },
    ];
  });

  const handleLoginSuccess = (username: string, key: string) => {
    setLoggedUser(username);
    setOperatorUsername(username);
    setUserGeminiKey(key);
    try {
      setSession(username);
      localStorage.setItem('er_gemini_key', key);
      addProviderKey('Edge Router', key);
    } catch { /* ignore */ }
    setIsLoginOpen(false);
    notify('success', `Welcome, ${username}`, 'Login ho gaya. KEYS button se har provider ki keys add karo.');
  };

  const handleLogout = () => {
    try {
      clearSession();
    } catch { /* ignore */ }
    setLoggedUser(null);
    setOperatorUsername('');
    setUserGeminiKey('');
    setIsLoginOpen(true);
    setIsCopilotOpen(false);
    setIsProfileOpen(false);
    notify('info', 'Logged out', 'Session band. Dobara login karo.');
  };

  const handleProfileUpdated = (username: string, key: string) => {
    setLoggedUser(username);
    setOperatorUsername(username);
    setUserGeminiKey(key);
    try { addProviderKey('Edge Router', key); } catch { /* ignore */ }
    notify('success', 'Profile updated', `${username} ka account save ho gaya.`);
  };

  // Profile icon: logged-in ho to Profile kholo, nahi to Login
  const handleOperatorClick = () => {
    if (loggedUser) setIsProfileOpen(true);
    else setIsLoginOpen(true);
  };

  // Sync state to local edge storage
  useEffect(() => {
    localStorage.setItem('er_providers', JSON.stringify(providers));
  }, [providers]);

  useEffect(() => {
    localStorage.setItem('er_active_provider', activeProviderId);
  }, [activeProviderId]);

  useEffect(() => {
    localStorage.setItem('er_endpoints', JSON.stringify(endpoints));
  }, [endpoints]);

  useEffect(() => {
    localStorage.setItem('er_routing_policy', routingPolicy);
  }, [routingPolicy]);

  useEffect(() => {
    localStorage.setItem('er_recent_decisions', JSON.stringify(recentDecisions.slice(0, 30)));
  }, [recentDecisions]);

  useEffect(() => {
    localStorage.setItem('er_fallback_chain', JSON.stringify(fallbackChain));
  }, [fallbackChain]);

  useEffect(() => {
    localStorage.setItem('er_daily_usages', JSON.stringify(dailyUsages));
  }, [dailyUsages]);

  useEffect(() => {
    localStorage.setItem('er_watchdog_active', String(isWatchdogActive));
  }, [isWatchdogActive]);

  useEffect(() => {
    localStorage.setItem('er_watchdog_logs', JSON.stringify(watchdogLogs.slice(0, 50)));
  }, [watchdogLogs]);

  const activeProvider =
    providers.find((p) => p.id === activeProviderId) || providers[0] || INITIAL_PROVIDERS[0];

  // Autonomous Self-Driving Watchdog Loop (Every 25 seconds)
  useEffect(() => {
    if (!isWatchdogActive) return;

    const interval = setInterval(() => {
      const healResult = AutonomousWatchdogService.runHealthCheckAndHeal({
        providers,
        endpoints,
        activeProvider,
        fallbackChain,
        dailyUsages,
        routingPolicy,
      });

      if (healResult.healed) {
        if (healResult.updatedEndpoints) {
          setEndpoints(healResult.updatedEndpoints);
        }
        if (healResult.newActiveProviderId && healResult.newActiveProviderId !== activeProviderId) {
          setActiveProviderId(healResult.newActiveProviderId);
        }
        if (healResult.newRoutingPolicy && healResult.newRoutingPolicy !== routingPolicy) {
          setRoutingPolicy(healResult.newRoutingPolicy);
        }
        if (healResult.event) {
          setWatchdogLogs((prev) => [healResult.event!, ...prev.slice(0, 49)]);
          if (healResult.event.type !== 'ping_sweep') {
            notify('agent', `Watchdog: ${healResult.event.title}`, healResult.event.actionTaken || healResult.event.description);
          }
        }
      }
    }, 25000);

    return () => clearInterval(interval);
  }, [isWatchdogActive, providers, endpoints, activeProvider, activeProviderId, fallbackChain, dailyUsages, routingPolicy]);

  // Live catalog auto-sync: login pe + har 6h (manual SYNC Tester me bhi hai)
  useEffect(() => {
    if (!loggedUser) return;
    let cancelled = false;
    const doSync = () => {
      runCatalogSync((providers || []).map((p) => p.id)).catch(() => {});
    };
    if (!cancelled) doSync();
    const interval = setInterval(() => {
      if (!cancelled) doSync();
    }, CATALOG_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loggedUser]);

  const handleTriggerWatchdogAudit = () => {
    const healResult = AutonomousWatchdogService.runHealthCheckAndHeal({
      providers,
      endpoints,
      activeProvider,
      fallbackChain,
      dailyUsages,
      routingPolicy,
    });

    if (healResult.event) {
      setWatchdogLogs((prev) => [healResult.event!, ...prev.slice(0, 49)]);
      notify('info', `Manual sweep: ${healResult.event.title}`, healResult.event.actionTaken || healResult.event.description);
    } else {
      const sweepEvent: WatchdogEvent = {
        id: 'wd_manual_' + Date.now(),
        timestamp: Date.now(),
        type: 'ping_sweep',
        title: 'Instant Autonomous Sweep Completed',
        description: `Verified ${endpoints.filter((e) => e.enabled).length} active nodes across ${providers.length} providers. All SLA tolerances passed.`,
        actionTaken: 'Zero latency anomalies detected. Topology optimal.',
      };
      setWatchdogLogs((prev) => [sweepEvent, ...prev.slice(0, 49)]);
    }

    if (healResult.updatedEndpoints) setEndpoints(healResult.updatedEndpoints);
    if (healResult.newActiveProviderId) setActiveProviderId(healResult.newActiveProviderId);
    if (healResult.newRoutingPolicy) setRoutingPolicy(healResult.newRoutingPolicy);
  };

  // Usage & Quota Handlers
  const handleUpdateUsage = (providerId: string, deltaRequests: number, deltaTokens: number) => {
    setDailyUsages((prev) => {
      const existing = prev[providerId] || {
        requestsUsed: 0,
        requestsLimit: 5000,
        tokensUsed: 0,
        tokensLimit: 2000000,
        primaryUnit: 'requests' as const,
      };
      return {
        ...prev,
        [providerId]: {
          ...existing,
          requestsUsed: Math.min(existing.requestsLimit, existing.requestsUsed + deltaRequests),
          tokensUsed: Math.min(existing.tokensLimit, existing.tokensUsed + deltaTokens),
        },
      };
    });
  };

  const handleResetUsage = (providerId?: string) => {
    const pname = providerId ? providers.find((p) => p.id === providerId)?.name || providerId : 'saare providers';
    notify('info', `Quota reset: ${pname}`, 'Counters zero kar diye.');
    if (providerId) {
      setDailyUsages((prev) => {
        const current = prev[providerId];
        if (!current) return prev;
        return {
          ...prev,
          [providerId]: {
            ...current,
            requestsUsed: 0,
            tokensUsed: 0,
          },
        };
      });
    } else {
      setDailyUsages((prev) => {
        const reset: typeof prev = {};
        Object.keys(prev).forEach((key) => {
          reset[key] = {
            ...prev[key],
            requestsUsed: 0,
            tokensUsed: 0,
          };
        });
        return reset;
      });
    }
  };

  // Handlers (each manual action fires a notification)
  const handleToggleEndpoint = (id: string) => {
    const ep = endpoints.find((e) => e.id === id);
    setEndpoints((prev) =>
      prev.map((e) => (e.id === id ? { ...e, enabled: !e.enabled } : e))
    );
    if (ep) notify('info', `Node ${ep.enabled ? 'OFF' : 'ON'}: ${ep.name}`, ep.enabled ? 'Is node pe traffic band.' : 'Node wapas live.');
  };

  const handleEditEndpoint = (endpoint: Endpoint) => {
    setEditingEndpoint(endpoint);
    setIsAddEndpointOpen(true);
  };

  const handleDeleteEndpoint = (id: string) => {
    const ep = endpoints.find((e) => e.id === id);
    setEndpoints((prev) => prev.filter((e) => e.id !== id));
    if (ep) notify('warn', `Node deleted: ${ep.name}`, 'Config se hata diya gaya.');
  };

  const handleSaveEndpoint = (savedEndpoint: Endpoint) => {
    const isEdit = endpoints.some((ep) => ep.id === savedEndpoint.id);
    setEndpoints((prev) => {
      if (isEdit) {
        return prev.map((ep) => (ep.id === savedEndpoint.id ? savedEndpoint : ep));
      }
      return [savedEndpoint, ...prev];
    });
    notify('success', isEdit ? `Node updated: ${savedEndpoint.name}` : `Node added: ${savedEndpoint.name}`, savedEndpoint.baseUrl);
  };

  const handleAddProvider = (newProvider: Provider) => {
    setProviders((prev) => [...prev, newProvider]);
    setActiveProviderId(newProvider.id);
    notify('success', `Provider added: ${newProvider.name}`, 'Ab Provider Keys me iski key dalo.');
  };

  const handleRunHealthSweep = async () => {
    setIsHealthSweeping(true);
    notify('info', 'Running live probe', 'Measuring real round-trip latency to the gateway.');
    try {
      const next = await EdgeRouterEngine.runHealthSweep(endpoints);
      setEndpoints(next);
      const stats = computeStats();
      setIsHealthSweeping(false);
      notify(
        'success',
        'Probe complete',
        stats.measured
          ? `${stats.samples} real samples • median ${stats.medianMs} ms • p95 ${stats.p95Ms} ms • uptime ${stats.uptimePct}%`
          : 'Nothing to probe — add a same-origin gateway endpoint first.',
      );
    } catch (err: any) {
      setIsHealthSweeping(false);
      notify('error', 'Probe failed', err?.message || 'Could not reach the gateway.');
    }
  };

  const handleRecordDecision = (decision: RoutingDecision, updatedEndpoints: Endpoint[]) => {
    setRecentDecisions((prev) => [decision, ...prev.slice(0, 40)]);
    setEndpoints(updatedEndpoints);
    if (decision.crossProviderFailover) {
      notify('warn', `Failover: ${decision.initialProviderName} → ${decision.providerName}`, decision.failoverReason || 'Quota/limit pe auto-shift.');
    }
  };

  const handleSetApiKey = (providerId: string, apiKey: string) => {
    // Copilot SET_API_KEY actions -> universal pool (dedup inside) + legacy slots for compat
    try {
      addProviderKey('Edge Router', apiKey);
    } catch { /* ignore */ }
    try {
      localStorage.setItem(`er_api_key_${providerId}`, apiKey);
    } catch { /* ignore */ }
    setEndpoints((prev) =>
      prev.map((ep) => (ep.providerId === providerId ? { ...ep, apiKey } : ep))
    );
    if (providerId === 'prov-gemini' || providerId === 'Edge Router') {
      setUserGeminiKey(apiKey);
      try {
        localStorage.setItem('er_gemini_key', apiKey);
        if (loggedUser) syncUserGeminiKey(loggedUser, apiKey);
      } catch { /* ignore */ }
    }
    notify('success', 'API key saved', 'Universal pool me add ho gayi.');
  };

  const handleRunEdgeTest = (promptText?: string) => {
    setActiveTab('tester');
    const testPrompt = promptText || 'Autonomous edge router latency verification test';
    notify('info', 'Edge test dispatch', 'Test request route ho rahi hai.');
    setTimeout(() => {
      try {
        const { decision, updatedEndpoints } = EdgeRouterEngine.routeRequest(
          activeProvider,
          endpoints,
          routingPolicy,
          'india',
          false,
          testPrompt,
          {
            enableCrossProviderFallback: true,
            allProviders: providers,
            fallbackChain,
            simulateQuotaExhaustion: false,
            providerKeys: getAllProviderKeys(providers.map((p) => p.id)),
          }
        );
        handleRecordDecision(decision, updatedEndpoints);
        handleUpdateUsage(decision.providerId, 1, decision.tokensUsed || 45);
        notify('success', `Edge test: ${decision.providerName}`, `${decision.latencyMs}ms • ${decision.tokensUsed || 0} tokens.`);
      } catch (err: any) {
        console.error('Test execution failed:', err);
        notify('error', 'Edge test fail', err?.message || 'Koi usable key wala provider nahi mila.');
      }
    }, 350);
  };

  const handleImportConfig = (data: { providers?: Provider[]; endpoints?: Endpoint[] }) => {
    if (data.providers && Array.isArray(data.providers)) {
      setProviders(data.providers);
      if (data.providers[0]) setActiveProviderId(data.providers[0].id);
    }
    if (data.endpoints && Array.isArray(data.endpoints)) {
      setEndpoints(data.endpoints);
    }
    notify('success', 'Config imported', 'Providers + endpoints load ho gaye.');
  };

  const activeEndpointsCount = endpoints.filter(
    (ep) => ep.providerId === activeProvider.id && ep.enabled
  ).length;
  const totalEndpointsCount = endpoints.filter((ep) => ep.providerId === activeProvider.id).length;

  if (!loggedUser) {
    return (
      <div className="min-h-screen bg-neutral-950 text-neutral-100 flex flex-col items-center justify-center p-6 font-mono">
        <div className="max-w-md w-full bg-neutral-900 border border-neutral-700 p-6 space-y-4 text-center">
          <div className="text-xs tracking-widest text-emerald-400">SINGLE GATEWAY // LOGIN REQUIRED</div>
          <h1 className="text-xl font-bold text-white uppercase">Edge Router Locked</h1>
          <p className="text-xs text-neutral-400 font-sans leading-relaxed">Pehle <strong>Create Account</strong> karo (username + password + Gemini key), fir 1 endpoint <strong>/api/v1/chat/completions</strong> + tumhari key se pura system chalega.</p>
          <button onClick={() => setIsLoginOpen(true)} className="w-full py-2.5 bg-white text-black font-bold uppercase text-xs">Login / Create Account</button>
        </div>
        <OperatorLoginModal isOpen={isLoginOpen} onClose={() => {}} onLoginSuccess={handleLoginSuccess} currentUsername={operatorUsername} currentGeminiKey={userGeminiKey} />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 flex flex-col selection:bg-neutral-200 selection:text-neutral-950 bg-grid-texture relative w-full max-w-full overflow-x-hidden">
      {/* Sticky Glass Navbar */}
      <Navbar
        providers={providers}
        activeProviderId={activeProviderId}
        onSelectProvider={setActiveProviderId}
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        onOpenAddEndpoint={() => {
          setEditingEndpoint(null);
          setIsAddEndpointOpen(true);
        }}
        onOpenAddProvider={() => setIsAddProviderOpen(true)}
        onRunHealthSweep={handleRunHealthSweep}
        isHealthSweeping={isHealthSweeping}
        activeEndpointsCount={activeEndpointsCount}
        totalEndpointsCount={totalEndpointsCount}
        operatorUsername={operatorUsername}
        onOpenLogin={handleOperatorClick}
        onOpenKeys={() => setIsKeysOpen(true)}
        bell={
          <NotificationsBell
            items={notifications}
            onMarkAllRead={markAllNotifRead}
            onClear={clearNotifications}
            onDismiss={dismissNotification}
          />
        }
        isCopilotOpen={isCopilotOpen}
        onToggleCopilot={() => setIsCopilotOpen(!isCopilotOpen)}
        isWatchdogActive={isWatchdogActive}
        onToggleWatchdog={() => setIsWatchdogActive(!isWatchdogActive)}
      />

      {/* Main Content with clean responsive containment */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-2.5 sm:px-6 lg:px-8 pt-4 sm:pt-8 pb-16 sm:pb-20 overflow-x-hidden min-w-0 max-w-full">
        <div
          key={activeTab + activeProviderId}
          className="min-w-0 w-full max-w-full overflow-x-hidden"
        >
          {activeTab === 'dashboard' && (
            <BentoDashboard
              activeProvider={activeProvider}
              endpoints={endpoints}
              routingPolicy={routingPolicy}
              onSelectPolicy={setRoutingPolicy}
              onToggleEndpoint={handleToggleEndpoint}
              onEditEndpoint={handleEditEndpoint}
              onDeleteEndpoint={handleDeleteEndpoint}
              onOpenAddEndpoint={() => {
                setEditingEndpoint(null);
                setIsAddEndpointOpen(true);
              }}
              recentDecisions={recentDecisions}
              onOpenTester={() => setActiveTab('tester')}
              onOpenQuota={() => setActiveTab('quota')}
              providers={providers}
              fallbackChain={fallbackChain}
              isWatchdogActive={isWatchdogActive}
              onToggleWatchdog={() => setIsWatchdogActive(!isWatchdogActive)}
              watchdogLogs={watchdogLogs}
              onTriggerWatchdogAudit={handleTriggerWatchdogAudit}
            />
          )}

          {activeTab === 'tester' && (
            <EdgeTester
              activeProvider={activeProvider}
              providers={providers}
              fallbackChain={fallbackChain}
              endpoints={endpoints}
              routingPolicy={routingPolicy}
              onRecordDecision={handleRecordDecision}
              onUpdateUsage={handleUpdateUsage}
            />
          )}

          {activeTab === 'quota' && (
            <DailyQuotaTracker
              providers={providers}
              activeProvider={activeProvider}
              onSelectProvider={setActiveProviderId}
              dailyUsages={dailyUsages as any}
              onUpdateUsage={handleUpdateUsage}
              onResetUsage={handleResetUsage}
              fallbackChain={fallbackChain}
            />
          )}

          {activeTab === 'telemetry' && (
            <TelemetryView
              activeProvider={activeProvider}
              endpoints={endpoints}
              decisions={recentDecisions}
              onOpenTester={() => setActiveTab('tester')}
            />
          )}

          {activeTab === 'export' && (
            <ConnectHub
              activeProvider={activeProvider}
              providers={providers}
              endpoints={endpoints}
              routingPolicy={routingPolicy}
              fallbackChain={fallbackChain}
              onImportConfig={handleImportConfig}
              userGeminiKey={userGeminiKey}
            />
          )}

          {activeTab === 'monitor' && (
            <ApiMonitor providers={providers} />
          )}
        </div>
      </main>

      {/* Brutalist Footer */}
      <footer className="border-t border-neutral-900 bg-neutral-950/80 py-5 sm:py-6 text-center text-xs font-mono text-neutral-500 w-full max-w-full overflow-hidden">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-3 sm:gap-4">
          <div className="flex flex-wrap items-center justify-center sm:justify-start gap-1.5 sm:gap-2">
            <span className="font-bold text-neutral-400 uppercase">[ER] EDGE ROUTER</span>
            <span>— Single Gateway • {loggedUser ? `Logged: ${loggedUser}` : ''}</span>
            {loggedUser && (
              <button onClick={handleLogout} className="ml-2 px-2 py-1 border border-neutral-700 text-neutral-300 hover:text-white text-[10px] uppercase">Logout</button>
            )}
          </div>
          <div className="flex flex-wrap items-center justify-center sm:justify-end gap-2 sm:gap-4 text-[10px] sm:text-[11px] text-neutral-400">
            <span>SINGLE ENDPOINT</span>
            <span>•</span>
            <span>PER-USER KEY</span>
            <span>•</span>
            <span>/api/v1/chat/completions</span>
          </div>
        </div>
      </footer>

      {/* Modals */}
      <EndpointModal
        isOpen={isAddEndpointOpen}
        onClose={() => {
          setIsAddEndpointOpen(false);
          setEditingEndpoint(null);
        }}
        activeProvider={activeProvider}
        endpointToEdit={editingEndpoint}
        onSaveEndpoint={handleSaveEndpoint}
      />

      <ProviderModal
        isOpen={isAddProviderOpen}
        onClose={() => setIsAddProviderOpen(false)}
        onAddProvider={handleAddProvider}
      />

      {/* Operator Login Modal */}
      <OperatorLoginModal
        isOpen={isLoginOpen}
        onClose={() => setIsLoginOpen(false)}
        onLoginSuccess={handleLoginSuccess}
        currentUsername={operatorUsername}
        currentGeminiKey={userGeminiKey}
      />

      {/* Profile / Account Settings Modal (profile icon click after login) */}
      <ProfileModal
        isOpen={isProfileOpen}
        onClose={() => setIsProfileOpen(false)}
        username={operatorUsername}
        currentGeminiKey={userGeminiKey}
        onUpdated={handleProfileUpdated}
        onLogout={handleLogout}
      />

      {/* Provider Keys Manager (unlimited keys per provider) */}
      <ProviderKeysModal
        isOpen={isKeysOpen}
        onClose={() => setIsKeysOpen(false)}
        providers={providers}
        onChanged={() => {
          // Keep Export tab key fresh with Gemini pool head
          try {
            const head = getProviderKeys('Edge Router')[0];
            if (head) setUserGeminiKey(head);
          } catch { /* ignore */ }
        }}
      />

      {/* Toasts for latest notifications */}
      <Toasts items={toasts} />

      {/* Autonomous AI Copilot & Voice Controller with Full Router Administrative Access */}
      <AutonomousCopilot
        isOpen={isCopilotOpen}
        onClose={() => setIsCopilotOpen(false)}
        providers={providers}
        activeProvider={activeProvider}
        endpoints={endpoints}
        routingPolicy={routingPolicy}
        fallbackChain={fallbackChain}
        onSelectProvider={setActiveProviderId}
        onSelectPolicy={setRoutingPolicy}
        onRunHealthSweep={handleRunHealthSweep}
        onSelectTab={setActiveTab}
        onSetApiKey={handleSetApiKey}
        onAddProvider={handleAddProvider}
        onSaveEndpoint={handleSaveEndpoint}
        onToggleEndpoint={handleToggleEndpoint}
        onDeleteEndpoint={handleDeleteEndpoint}
        onSetFallbackChain={setFallbackChain}
        onResetUsage={handleResetUsage}
        onRunEdgeTest={handleRunEdgeTest}
        onGenerateNewProxyKey={() => {
          const newKey = `sk-er-live-${Array.from(crypto.getRandomValues(new Uint8Array(16)))
            .map((b) => b.toString(16).padStart(2, '0'))
            .join('')}`;
          localStorage.setItem('edge_router_proxy_key', newKey);
        }}
        operatorUsername={operatorUsername}
        userGeminiKey={userGeminiKey}
        onOpenLogin={handleOperatorClick}
      />
    </div>
  );
}

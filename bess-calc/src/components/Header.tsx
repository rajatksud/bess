import React from 'react';
import { CurrencySymbol } from '../types/bess';
import { Zap, Calculator, BarChart3, ShieldAlert, FileText, Sparkles, FolderKanban } from 'lucide-react';

interface HeaderProps {
  currency: CurrencySymbol;
  onCurrencyChange: (c: CurrencySymbol) => void;
  activeTab: 'quick' | 'interval' | 'comparison' | 'scenario' | 'project';
  onTabChange: (tab: 'quick' | 'interval' | 'comparison' | 'scenario' | 'project') => void;
  onOpenExportModal: () => void;
  confidenceGrade: 'A' | 'B' | 'C' | 'D';
}

export const Header: React.FC<HeaderProps> = ({
  currency,
  onCurrencyChange,
  activeTab,
  onTabChange,
  onOpenExportModal,
  confidenceGrade
}) => {
  return (
    <header className="bg-slate-900 border-b border-slate-800 sticky top-0 z-30 shadow-md">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3.5">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          
          {/* Logo & Branding */}
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-emerald-500 to-cyan-500 flex items-center justify-center text-slate-950 font-bold shadow-lg shadow-emerald-500/20">
              <Zap className="w-6 h-6 fill-slate-950" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h1 className="text-lg font-bold text-white tracking-tight">BESS ROI & Sizing Platform</h1>
                <span className="text-xs px-2 py-0.5 rounded-full bg-slate-800 border border-slate-700 text-slate-300 font-medium">
                  v2.4 Engineering
                </span>
              </div>
              <p className="text-xs text-slate-400">Defensible Single-Energy-Balance Battery Economics & Dispatch Engine</p>
            </div>
          </div>

          {/* Mode Tabs */}
          <div className="flex items-center bg-slate-950 p-1 rounded-xl border border-slate-800 overflow-x-auto">
            <button
              onClick={() => onTabChange('quick')}
              className={`flex items-center space-x-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                activeTab === 'quick'
                  ? 'bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/20'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
              }`}
            >
              <Calculator className="w-3.5 h-3.5" />
              <span>Quick Sizing</span>
            </button>

            <button
              onClick={() => onTabChange('interval')}
              className={`flex items-center space-x-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                activeTab === 'interval'
                  ? 'bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/20'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
              }`}
            >
              <BarChart3 className="w-3.5 h-3.5" />
              <span>Interval Dispatch</span>
            </button>

            <button
              onClick={() => onTabChange('scenario')}
              className={`flex items-center space-x-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                activeTab === 'scenario'
                  ? 'bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/20'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Scenarios & Sensitivity</span>
            </button>

            <button
              onClick={() => onTabChange('project')}
              className={`flex items-center space-x-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                activeTab === 'project'
                  ? 'bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/20'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
              }`}
            >
              <FolderKanban className="w-3.5 h-3.5" />
              <span>Projects</span>
            </button>

            <button
              onClick={() => onTabChange('comparison')}
              className={`flex items-center space-x-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                activeTab === 'comparison'
                  ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/20'
                  : 'text-amber-400 hover:text-amber-300 hover:bg-slate-900'
              }`}
            >
              <ShieldAlert className="w-3.5 h-3.5" />
              <span>Sales Pitch Audit</span>
            </button>
          </div>

          {/* Right Controls */}
          <div className="flex items-center space-x-3">
            
            {/* Confidence Badge */}
            <div className="flex items-center space-x-1.5 px-2.5 py-1 rounded-lg bg-slate-800 border border-slate-700 text-xs">
              <span className="text-slate-400">Confidence:</span>
              <span className={`font-bold px-1.5 py-0.5 rounded ${
                confidenceGrade === 'A' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' :
                confidenceGrade === 'B' ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30' :
                confidenceGrade === 'C' ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30' :
                'bg-rose-500/20 text-rose-400 border border-rose-500/30'
              }`}>
                Grade {confidenceGrade}
              </span>
            </div>

            {/* Currency Selector */}
            <div className="flex items-center bg-slate-950 rounded-lg p-0.5 border border-slate-800 text-xs font-semibold">
              {(['₹', '$', '€', '£'] as CurrencySymbol[]).map(symbol => (
                <button
                  key={symbol}
                  onClick={() => onCurrencyChange(symbol)}
                  className={`w-7 h-7 rounded-md transition-all ${
                    currency === symbol
                      ? 'bg-slate-800 text-emerald-400 font-bold shadow-sm'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {symbol}
                </button>
              ))}
            </div>

            {/* Export Report Button */}
            <button
              onClick={onOpenExportModal}
              className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold border border-slate-700 transition-all shadow-sm"
            >
              <FileText className="w-3.5 h-3.5 text-emerald-400" />
              <span className="hidden sm:inline">Export Audit Report</span>
            </button>

          </div>

        </div>
      </div>
    </header>
  );
};

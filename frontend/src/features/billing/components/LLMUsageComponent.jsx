import React, { useState, useEffect } from 'react';
import { TrendingUp, DollarSign, Hash, AlertCircle, RefreshCw, ChevronDown } from 'lucide-react';
import { USER_RESOURCES_SERVICE_URL } from '@/config/apiConfig';

const AVAILABLE_MODELS = [
  { label: 'Gemini 2.0 Flash', value: 'gemini-2.0-flash' },
  { label: 'Gemini 2.0 Flash-001', value: 'gemini-2.0-flash-001' },
  { label: 'Gemini 2.0 Flash-Lite', value: 'gemini-2.0-flash-lite' },
  { label: 'Gemini 2.5 Flash', value: 'gemini-2.5-flash' },
  { label: 'Gemini 2.5 Flash-001', value: 'gemini-2.5-flash-001' },
  { label: 'Gemini 2.5 Flash-Lite', value: 'gemini-2.5-flash-lite' },
  { label: 'Gemini 2.5 Pro', value: 'gemini-2.5-pro' },
  { label: 'Gemini 2.5 Pro-001', value: 'gemini-2.5-pro-001' },
  { label: 'Gemini 3 Flash', value: 'gemini-3-flash' },
  { label: 'Gemini 3 Flash-001', value: 'gemini-3-flash-001' },
  { label: 'Gemini 3 Pro Preview', value: 'gemini-3-pro-preview' },
];

const LLMUsageComponent = () => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [usageData, setUsageData] = useState(null);
  const [filters, setFilters] = useState({
    modelName: ''
  });
  const [showModelDropdown, setShowModelDropdown] = useState(false);
  const [filteredModels, setFilteredModels] = useState(AVAILABLE_MODELS);

  const fetchLLMUsage = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const token = localStorage.getItem('token');
      const params = new URLSearchParams();
      if (filters.modelName) params.append('modelName', filters.modelName);

      const response = await fetch(`${USER_RESOURCES_SERVICE_URL}/llm-usage?${params.toString()}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        credentials: 'include'
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      
      const data = await response.json();
      setUsageData(data.data);
    } catch (err) {
      console.error('Error fetching LLM usage:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLLMUsage();
  }, []);

  // Initialize filtered models on component mount
  useEffect(() => {
    setFilteredModels(AVAILABLE_MODELS);
  }, []);

  const formatCurrency = (amount) => {
    if (amount === null || amount === undefined || isNaN(amount)) return '₹0.00';
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      minimumFractionDigits: 2,
      maximumFractionDigits: 4
    }).format(amount);
  };

  const formatNumber = (num) => {
    if (num === null || num === undefined) return '0';
    return new Intl.NumberFormat('en-IN').format(num);
  };

  const handleFilterChange = (field, value) => {
    setFilters(prev => ({ ...prev, [field]: value }));
    
    // Filter models based on typed value
    if (field === 'modelName') {
      const filtered = AVAILABLE_MODELS.filter(model => 
        model.label.toLowerCase().includes(value.toLowerCase()) ||
        model.value.toLowerCase().includes(value.toLowerCase())
      );
      setFilteredModels(filtered);
      setShowModelDropdown(true);
    }
  };

  const handleModelSelect = (modelValue) => {
    setFilters(prev => ({ ...prev, modelName: modelValue }));
    setShowModelDropdown(false);
  };

  const handleApplyFilters = () => {
    setShowModelDropdown(false);
    fetchLLMUsage();
  };

  const handleClearFilters = () => {
    setFilters({ modelName: '' });
    setFilteredModels(AVAILABLE_MODELS);
    setShowModelDropdown(false);
    setTimeout(() => fetchLLMUsage(), 100);
  };

  if (loading && !usageData) {
    return (
      <div className="flex justify-center items-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#21C1B6]"></div>
        <span className="ml-3 text-gray-600">Loading LLM usage data...</span>
      </div>
    );
  }

  if (error && !usageData) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-6">
        <div className="flex items-center">
          <AlertCircle className="h-5 w-5 text-red-500 mr-2" />
          <h3 className="text-red-800 font-medium">Error loading LLM usage</h3>
        </div>
        <p className="text-red-700 mt-2">{error}</p>
        <button 
          onClick={fetchLLMUsage}
          className="mt-4 px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
        >
          Retry
        </button>
      </div>
    );
  }

      const summary = usageData?.summary || {};

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="bg-white border border-gray-300 rounded-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-gray-900">Filters</h3>
          <div className="flex gap-2">
            <button
              onClick={handleApplyFilters}
              className="px-4 py-2 bg-[#21C1B6] text-white font-medium rounded-lg hover:bg-[#1AA49B]"
            >
              Apply Filters
            </button>
            <button
              onClick={handleClearFilters}
              className="px-4 py-2 bg-gray-200 text-gray-700 font-medium rounded-lg hover:bg-gray-300"
            >
              Clear
            </button>
            <button
              onClick={fetchLLMUsage}
              className="px-4 py-2 bg-gray-200 text-gray-700 font-medium rounded-lg hover:bg-gray-300 flex items-center"
            >
              <RefreshCw size={16} className="mr-2" />
              Refresh
            </button>
          </div>
        </div>
        <div className="grid md:grid-cols-1 gap-4">
          <div className="relative">
            <label className="block text-sm font-medium text-gray-900 mb-1">Model Name</label>
            <div className="relative">
              <input
                type="text"
                value={filters.modelName}
                onChange={(e) => handleFilterChange('modelName', e.target.value)}
                onFocus={() => setShowModelDropdown(true)}
                onBlur={() => {
                  // Delay to allow dropdown click to register
                  setTimeout(() => setShowModelDropdown(false), 200);
                }}
                placeholder="Type or select a model (e.g., gemini-2.5-flash)"
                className="w-full px-3 py-2 pr-10 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#21C1B6] focus:border-transparent"
              />
              <ChevronDown 
                className="absolute right-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400 pointer-events-none"
              />
            </div>
            
            {/* Dropdown */}
            {showModelDropdown && filteredModels.length > 0 && (
              <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-60 overflow-auto">
                {filteredModels.map((model) => (
                  <button
                    key={model.value}
                    type="button"
                    onClick={() => handleModelSelect(model.value)}
                    className="w-full text-left px-4 py-2 hover:bg-[#21C1B6] hover:text-white transition-colors first:rounded-t-lg last:rounded-b-lg"
                  >
                    <div className="font-medium">{model.label}</div>
                    <div className="text-xs text-gray-500 hover:text-white">{model.value}</div>
                  </button>
                ))}
              </div>
            )}
            
            {/* Show message if no models match */}
            {showModelDropdown && filters.modelName && filteredModels.length === 0 && (
              <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg p-4 text-center text-gray-500">
                No models found matching "{filters.modelName}"
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid md:grid-cols-4 gap-6">
        <div className="bg-white border border-gray-300 rounded-lg p-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-semibold text-gray-900 uppercase">Total Requests</span>
            <Hash className="h-5 w-5 text-gray-500" />
          </div>
          <div className="text-3xl font-bold text-gray-900">{formatNumber(summary.total_requests)}</div>
        </div>

        <div className="bg-white border border-gray-300 rounded-lg p-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-semibold text-gray-900 uppercase">Total Tokens</span>
            <TrendingUp className="h-5 w-5 text-gray-500" />
          </div>
          <div className="text-3xl font-bold text-gray-900">{formatNumber(summary.total_tokens)}</div>
          <div className="text-sm text-gray-600 mt-1">
            In: {formatNumber(summary.total_input_tokens)} | Out: {formatNumber(summary.total_output_tokens)}
          </div>
        </div>

        <div className="bg-white border border-gray-300 rounded-lg p-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-semibold text-gray-900 uppercase">Total Cost</span>
            <DollarSign className="h-5 w-5 text-gray-500" />
          </div>
          <div className="text-3xl font-bold text-gray-900">{formatCurrency(summary.total_cost)}</div>
          <div className="text-sm text-gray-600 mt-1">
            Input: {formatCurrency(summary.total_input_cost)} | Output: {formatCurrency(summary.total_output_cost)}
          </div>
        </div>

        <div className="bg-white border border-gray-300 rounded-lg p-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-semibold text-gray-900 uppercase">Models Used</span>
            <Hash className="h-5 w-5 text-gray-500" />
          </div>
          <div className="text-3xl font-bold text-gray-900">{formatNumber(summary.unique_models)}</div>
        </div>
      </div>

    </div>
  );
};

export default LLMUsageComponent;



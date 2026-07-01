import React, { createContext, useContext, useState, useCallback } from 'react';
import { AlertCircle, CheckCircle, HelpCircle, AlertTriangle, X } from 'lucide-react';

type DialogType = 'alert' | 'confirm';
type DialogVariant = 'info' | 'success' | 'warning' | 'danger';

interface DialogOptions {
  title: string;
  message: string;
  type: DialogType;
  variant?: DialogVariant;
  confirmText?: string;
  cancelText?: string;
}

interface DialogContextType {
  alert: (title: string, message: string, variant?: DialogVariant) => Promise<boolean>;
  confirm: (title: string, message: string, variant?: DialogVariant) => Promise<boolean>;
}

const DialogContext = createContext<DialogContextType | undefined>(undefined);

export const useCustomDialog = () => {
  const context = useContext(DialogContext);
  if (!context) {
    throw new Error('useCustomDialog must be used within a CustomDialogProvider');
  }
  return context;
};

export const CustomDialogProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [dialogState, setDialogState] = useState<{
    isOpen: boolean;
    config: DialogOptions | null;
    resolve: ((value: boolean) => void) | null;
  }>({
    isOpen: false,
    config: null,
    resolve: null,
  });

  const showDialog = useCallback((options: DialogOptions) => {
    return new Promise<boolean>((resolve) => {
      setDialogState({
        isOpen: true,
        config: options,
        resolve,
      });
    });
  }, []);

  const alert = useCallback((title: string, message: string, variant: DialogVariant = 'info') => {
    return showDialog({ title, message, type: 'alert', variant, confirmText: 'OK' });
  }, [showDialog]);

  const confirm = useCallback((title: string, message: string, variant: DialogVariant = 'warning') => {
    return showDialog({ title, message, type: 'confirm', variant, confirmText: 'Confirm', cancelText: 'Cancel' });
  }, [showDialog]);

  const handleClose = (value: boolean) => {
    if (dialogState.resolve) {
      dialogState.resolve(value);
    }
    setDialogState({ isOpen: false, config: null, resolve: null });
  };

  const getIcon = (variant?: DialogVariant) => {
    switch (variant) {
      case 'success':
        return <CheckCircle className="text-brand-emerald shrink-0" size={24} />;
      case 'danger':
        return <AlertCircle className="text-brand-coral shrink-0" size={24} />;
      case 'warning':
        return <AlertTriangle className="text-amber-400 shrink-0" size={24} />;
      default:
        return <HelpCircle className="text-brand-teal shrink-0" size={24} />;
    }
  };

  const getVariantStyles = (variant?: DialogVariant) => {
    switch (variant) {
      case 'success':
        return 'border-brand-emerald/30 shadow-brand-emerald/5';
      case 'danger':
        return 'border-brand-coral/30 shadow-brand-coral/5';
      case 'warning':
        return 'border-amber-500/30 shadow-amber-500/5';
      default:
        return 'border-brand-teal/30 shadow-brand-teal/5';
    }
  };

  const getButtonStyles = (variant?: DialogVariant) => {
    switch (variant) {
      case 'success':
        return 'bg-brand-emerald hover:bg-brand-emerald/90 text-workspace-950 shadow-glow-emerald';
      case 'danger':
        return 'bg-brand-coral hover:bg-brand-coral/90 text-workspace-950 shadow-glow-coral';
      default:
        return 'bg-brand-teal hover:bg-brand-teal/90 text-workspace-950 shadow-glow-teal';
    }
  };

  return (
    <DialogContext.Provider value={{ alert, confirm }}>
      {children}
      {dialogState.isOpen && dialogState.config && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[99999] flex items-center justify-center p-4">
          <div
            className={`w-full max-w-md bg-workspace-850 border rounded-2xl shadow-2xl p-6 relative overflow-hidden font-sans ${getVariantStyles(
              dialogState.config.variant
            )}`}
          >
            {/* Header */}
            <div className="flex items-start space-x-4">
              {getIcon(dialogState.config.variant)}
              <div className="flex-1 min-w-0">
                <h3 className="text-base font-semibold text-workspace-50 leading-6">
                  {dialogState.config.title}
                </h3>
                <p className="mt-2 text-xs text-workspace-400 leading-relaxed font-mono whitespace-pre-line">
                  {dialogState.config.message}
                </p>
              </div>
              <button
                onClick={() => handleClose(false)}
                className="text-workspace-600 hover:text-workspace-200 transition-colors"
              >
                <X size={16} />
              </button>
            </div>

            {/* Actions */}
            <div className="mt-6 flex items-center justify-end space-x-3">
              {dialogState.config.type === 'confirm' && (
                <button
                  onClick={() => handleClose(false)}
                  className="px-4 py-2 border border-workspace-750 text-workspace-300 hover:text-workspace-100 hover:bg-workspace-800 rounded-lg text-xs font-bold transition-all cursor-pointer"
                >
                  {dialogState.config.cancelText}
                </button>
              )}
              <button
                onClick={() => handleClose(true)}
                className={`px-4 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${getButtonStyles(
                  dialogState.config.variant
                )}`}
              >
                {dialogState.config.confirmText}
              </button>
            </div>
          </div>
        </div>
      )}
    </DialogContext.Provider>
  );
};

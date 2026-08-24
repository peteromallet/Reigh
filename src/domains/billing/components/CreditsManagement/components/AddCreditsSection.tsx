import { useState, useEffect, useRef } from 'react';
import { Coins, CreditCard, DollarSign } from 'lucide-react';
import { Button } from '@/shared/components/ui/button';
import { Slider } from '@/shared/components/ui/slider';
import { Checkbox } from '@/shared/components/ui/checkbox';
import { NumberInput } from '@/shared/components/ui/number-input';
import { formatDollarAmount } from '../utils/formatters';
import type { AutoTopupState } from '../types';

interface AddCreditsSectionProps {
  // Balance
  balance: number | undefined;
  isLoadingBalance: boolean;
  formatCurrency: (amount: number) => string;

  // Purchase
  purchaseAmount: number;
  onPurchaseAmountChange: (amount: number) => void;
  isCreatingCheckout: boolean;
  onPurchase: () => void;

  // Auto-top-up
  localAutoTopupEnabled: boolean;
  localAutoTopupThreshold: number;
  autoTopupState: AutoTopupState;
  isUpdatingAutoTopup: boolean;
  onAutoTopupToggle: (enabled: boolean) => void;
  onAutoTopupThresholdChange: (threshold: number) => void;
}

export function AddCreditsSection({
  balance,
  isLoadingBalance,
  formatCurrency,
  purchaseAmount,
  onPurchaseAmountChange,
  isCreatingCheckout,
  onPurchase,
  localAutoTopupEnabled,
  localAutoTopupThreshold,
  autoTopupState,
  isUpdatingAutoTopup,
  onAutoTopupToggle,
  onAutoTopupThresholdChange,
}: AddCreditsSectionProps) {
  const [showUpdated, setShowUpdated] = useState(false);
  const wasUpdatingRef = useRef(false);

  // Show "Updated" briefly when auto-topup finishes saving and is enabled
  useEffect(() => {
    if (wasUpdatingRef.current && !isUpdatingAutoTopup && localAutoTopupEnabled) {
      setShowUpdated(true);
      const timer = setTimeout(() => setShowUpdated(false), 2000);
      return () => clearTimeout(timer);
    }
    wasUpdatingRef.current = isUpdatingAutoTopup;
  }, [isUpdatingAutoTopup, localAutoTopupEnabled]);

  return (
    <div className="space-y-3">
      {/* Current Balance Container */}
      <div className="p-3 bg-emerald-50/50 dark:bg-emerald-950/30 rounded-lg border border-emerald-100 dark:border-emerald-800">
        <div className="flex items-center gap-2">
          <Coins className="h-4 w-4 text-emerald-500 dark:text-emerald-400" />
          <span className="text-sm font-medium text-emerald-700 dark:text-emerald-300">Current balance:</span>
          <span className="text-lg font-semibold text-foreground ml-auto">
            {isLoadingBalance ? (
              <span className="animate-pulse bg-muted rounded w-16 h-5 inline-block"></span>
            ) : (
              formatCurrency(balance || 0)
            )}
          </span>
        </div>
      </div>

      {/* Add Credits Container */}
      <div className="p-3 bg-blue-50/50 dark:bg-blue-950/30 rounded-lg border border-blue-100 dark:border-blue-800 space-y-3">
        <div className="flex items-center gap-2">
          <CreditCard className="h-4 w-4 text-blue-500 dark:text-blue-400" />
          <span className="text-sm font-medium text-blue-700 dark:text-blue-300">Add credits:</span>
          <span className="text-lg font-semibold text-foreground ml-auto">{formatDollarAmount(purchaseAmount)}</span>
        </div>

        <div className="px-1">
          <Slider
            value={[purchaseAmount]}
            onValueChange={(value) => onPurchaseAmountChange(Array.isArray(value) ? (value[0] ?? 0) : value)}
            min={0}
            max={100}
            step={5}
          />
          <div className="flex justify-between text-xs text-muted-foreground mt-1">
            <span>$0</span>
            <span>$100</span>
          </div>
        </div>

        {/* Auto top-up */}
        <div className="flex items-center text-sm pt-2 border-t border-blue-100 dark:border-blue-800">
          <div className="flex items-center gap-2">
            <Checkbox
              id="auto-topup"
              checked={localAutoTopupEnabled}
              onCheckedChange={(checked) => onAutoTopupToggle(checked === true)}
              disabled={isUpdatingAutoTopup}
            />
            <label htmlFor="auto-topup" className="text-muted-foreground cursor-pointer">
              Auto top-up when below
            </label>
            <NumberInput
              value={localAutoTopupThreshold}
              onChange={(val) => {
                const clamped = Math.min(Math.max(1, val ?? 1), Math.max(1, purchaseAmount - 1));
                onAutoTopupThresholdChange(clamped);
              }}
              min={1}
              max={Math.max(1, purchaseAmount - 1)}
              disabled={!localAutoTopupEnabled || isUpdatingAutoTopup}
              prefix="$"
              className="w-20 h-7 text-sm border-border"
            />
          </div>
          <div className="flex items-center ml-auto gap-1.5">
            {showUpdated && (
              <span className="text-xs text-blue-600 animate-in fade-in duration-200">Updated</span>
            )}
            {localAutoTopupEnabled && autoTopupState === 'active' && (
              <span className="text-xs text-green-600">✓ Active</span>
            )}
          </div>
        </div>

        <Button
          variant="retro"
          size="retro-sm"
          onClick={onPurchase}
          disabled={isCreatingCheckout || purchaseAmount === 0}
          className="w-full"
        >
          {isCreatingCheckout ? (
            <DollarSign className="w-4 h-4 animate-spin" />
          ) : purchaseAmount === 0 ? (
            "Select an amount"
          ) : localAutoTopupEnabled && autoTopupState === 'enabled-but-not-setup' ? (
            <>Add {formatDollarAmount(purchaseAmount)} and set up auto-top-up</>
          ) : (
            <>Add {formatDollarAmount(purchaseAmount)}</>
          )}
        </Button>
      </div>
    </div>
  );
}

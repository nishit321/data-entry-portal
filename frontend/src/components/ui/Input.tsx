import { forwardRef, type InputHTMLAttributes } from 'react';
import { controlBase, controlInvalid } from './_styles';

/**
 * The single text input. Set `aria-invalid` (FormField does this automatically) and it
 * shows the error border — no separate error styling needed. `forwardRef` so
 * react-hook-form's `register` works directly.
 */
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className = '', ...props }, ref) {
    return (
      <input ref={ref} className={`${controlBase} ${controlInvalid} ${className}`} {...props} />
    );
  },
);

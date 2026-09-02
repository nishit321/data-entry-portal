import { forwardRef, useState, type InputHTMLAttributes } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { controlBase, controlInvalid } from './_styles';

/**
 * Password field with a show/hide toggle, on the shared control styling. Part of the one
 * input system (FRONTEND_STANDARDS §3.4) — auth screens use this, not a parallel component.
 * `forwardRef` so react-hook-form's `register` works directly.
 */
export const PasswordInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function PasswordInput({ className = '', ...props }, ref) {
    const [show, setShow] = useState(false);
    return (
      <div className="relative">
        <input
          ref={ref}
          type={show ? 'text' : 'password'}
          className={`${controlBase} ${controlInvalid} pr-10 ${className}`}
          {...props}
        />
        {/*
          In the tab order. It used to carry tabIndex={-1}, which kept the tab sequence tidy at the
          cost of the people the toggle exists for: someone who mistypes, or who needs to check a
          long password before submitting, and does not use a mouse. §6 says every interactive
          primitive works without one, and this was the exception nobody had noticed.
        */}
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-gray-500 hover:text-gray-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          // A toggle button keeps one name and reports its state, rather than renaming itself.
          // A name that changes under you is disorienting to listen to.
          aria-label="Show password"
          aria-pressed={show}
        >
          {show ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
      </div>
    );
  },
);

'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { ApiError } from '@/lib/api';
import { registerWithPassword } from '@/lib/services';
import styles from '../login/login.module.css';

type RegisterField = 'displayName' | 'email' | 'password' | 'confirmPassword';

type RegisterValues = Record<RegisterField, string>;
type RegisterErrors = Partial<Record<RegisterField, string>>;

const EMPTY_VALUES: RegisterValues = {
  displayName: '',
  email: '',
  password: '',
  confirmPassword: ''
};

function validateField(field: RegisterField, values: RegisterValues): string {
  const trimmedValue = values[field].trim();

  switch (field) {
    case 'displayName':
      return trimmedValue.length >= 2 ? '' : '请输入至少 2 个字符的显示名称。';
    case 'email':
      return trimmedValue.length >= 5 && trimmedValue.includes('@') ? '' : '请输入有效的邮箱地址。';
    case 'password':
      return values.password.trim().length >= 8 ? '' : '密码至少需要 8 个字符。';
    case 'confirmPassword':
      return values.confirmPassword === values.password ? '' : '两次输入的密码不一致。';
    default:
      return '';
  }
}

function collectErrors(values: RegisterValues): RegisterErrors {
  return {
    displayName: validateField('displayName', values),
    email: validateField('email', values),
    password: validateField('password', values),
    confirmPassword: validateField('confirmPassword', values)
  };
}

export default function RegisterForm() {
  const router = useRouter();
  const [hydrated, setHydrated] = useState(false);
  const [values, setValues] = useState<RegisterValues>(EMPTY_VALUES);
  const [errors, setErrors] = useState<RegisterErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setHydrated(true);
  }, []);

  const updateField = (field: RegisterField, nextValue: string) => {
    setValues((current) => {
      const nextValues = {
        ...current,
        [field]: nextValue
      };

      setErrors((currentErrors) => ({
        ...currentErrors,
        [field]: currentErrors[field] ? validateField(field, nextValues) : currentErrors[field],
        ...(field === 'password' && currentErrors.confirmPassword
          ? {
              confirmPassword: validateField('confirmPassword', nextValues)
            }
          : {})
      }));

      return nextValues;
    });
  };

  const handleBlur = (field: RegisterField) => {
    setErrors((current) => ({
      ...current,
      [field]: validateField(field, values),
      ...(field === 'password'
        ? {
            confirmPassword: validateField('confirmPassword', values)
          }
        : {})
    }));
  };

  const focusFirstInvalidField = (nextErrors: RegisterErrors) => {
    const order: RegisterField[] = ['displayName', 'email', 'password', 'confirmPassword'];
    const firstInvalidField = order.find((field) => nextErrors[field]);

    if (firstInvalidField) {
      document.querySelector<HTMLElement>(`[data-testid="register-${firstInvalidField}-input"]`)?.focus();
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextErrors = collectErrors(values);

    setErrors(nextErrors);
    setSubmitError(null);

    if (Object.values(nextErrors).some(Boolean)) {
      focusFirstInvalidField(nextErrors);
      return;
    }

    setLoading(true);

    try {
      await registerWithPassword({
        displayName: values.displayName,
        email: values.email,
        password: values.password
      });

      router.push(
        `/login?registered=1&email=${encodeURIComponent(values.email.trim().toLowerCase())}`
      );
    } catch (error) {
      setSubmitError(
        error instanceof ApiError ? error.message : '注册失败，请稍后重试。'
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <form
      className={styles.form}
      onSubmit={handleSubmit}
      data-testid="register-form"
      data-hydrated={hydrated ? 'true' : 'false'}
    >
      <div
        className={`${styles.statusAlert} ${styles.successAlert}`}
        role="note"
        data-testid="register-helper-text"
      >
        注册成功后系统会自动创建一个默认租户，方便你直接沿用现有登录链路进入控制台。
      </div>

      {submitError ? (
        <div
          className={`${styles.statusAlert} ${styles.errorAlert}`}
          role="alert"
          aria-live="assertive"
          data-testid="register-form-alert"
        >
          {submitError}
        </div>
      ) : null}

      <div className={styles.formGroup}>
        <label htmlFor="displayName" className={styles.label}>
          显示名称
        </label>
        <input
          id="displayName"
          type="text"
          value={values.displayName}
          onChange={(event) => updateField('displayName', event.target.value)}
          onBlur={() => handleBlur('displayName')}
          className={`${styles.input} ${errors.displayName ? styles.inputError : ''}`.trim()}
          placeholder="请输入你的名称或团队称呼"
          autoComplete="name"
          data-testid="register-display-name-input"
        />
        <p className={styles.helperText}>后续默认租户会沿用这个名称，方便登录后直接进入控制台。</p>
        {errors.displayName ? (
          <div className={styles.fieldError} role="alert" data-testid="register-display-name-error">
            {errors.displayName}
          </div>
        ) : null}
      </div>

      <div className={styles.formGroup}>
        <label htmlFor="email" className={styles.label}>
          邮箱地址
        </label>
        <input
          id="email"
          type="email"
          value={values.email}
          onChange={(event) => updateField('email', event.target.value)}
          onBlur={() => handleBlur('email')}
          className={`${styles.input} ${errors.email ? styles.inputError : ''}`.trim()}
          placeholder="请输入可用于登录的邮箱"
          autoComplete="email"
          data-testid="register-email-input"
        />
        {errors.email ? (
          <div className={styles.fieldError} role="alert" data-testid="register-email-error">
            {errors.email}
          </div>
        ) : null}
      </div>

      <div className={styles.formGroup}>
        <label htmlFor="password" className={styles.label}>
          密码
        </label>
        <input
          id="password"
          type="password"
          value={values.password}
          onChange={(event) => updateField('password', event.target.value)}
          onBlur={() => handleBlur('password')}
          className={`${styles.input} ${errors.password ? styles.inputError : ''}`.trim()}
          placeholder="请输入至少 8 个字符的密码"
          autoComplete="new-password"
          data-testid="register-password-input"
        />
        {errors.password ? (
          <div className={styles.fieldError} role="alert" data-testid="register-password-error">
            {errors.password}
          </div>
        ) : null}
      </div>

      <div className={styles.formGroup}>
        <label htmlFor="confirmPassword" className={styles.label}>
          确认密码
        </label>
        <input
          id="confirmPassword"
          type="password"
          value={values.confirmPassword}
          onChange={(event) => updateField('confirmPassword', event.target.value)}
          onBlur={() => handleBlur('confirmPassword')}
          className={`${styles.input} ${errors.confirmPassword ? styles.inputError : ''}`.trim()}
          placeholder="请再次输入同一密码"
          autoComplete="new-password"
          data-testid="register-confirm-password-input"
        />
        {errors.confirmPassword ? (
          <div
            className={styles.fieldError}
            role="alert"
            data-testid="register-confirm-password-error"
          >
            {errors.confirmPassword}
          </div>
        ) : null}
      </div>

      <button
        type="submit"
        disabled={loading}
        className={styles.submitButton}
        data-testid="register-submit-button"
        data-loading-state={loading ? 'submitting' : 'idle'}
        aria-busy={loading}
      >
        {loading ? '正在创建账号...' : '创建账号'}
      </button>

      <p className={styles.alternateAction}>
        已有账号？
        <a href="/login" className={styles.alternateLink} data-testid="register-login-link">
          返回登录
        </a>
      </p>
    </form>
  );
}

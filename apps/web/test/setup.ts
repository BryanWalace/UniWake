import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';

// The full suite runs ~55 workers in parallel; a first render can take over the default 1 s there.
configure({ asyncUtilTimeout: 5_000 });

afterEach(() => cleanup());

/**
 * AuthGuard Component Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import AuthGuard from '@/components/AuthGuard.vue'

// Mock the useAuth composable
vi.mock('@/composables/useAuth', () => ({
  useAuth: vi.fn(() => ({
    isAuthenticated: { value: false },
    authRequired: { value: true },
    isChecking: { value: false },
    error: { value: null },
    login: vi.fn(),
    logout: vi.fn(),
    initialize: vi.fn(),
  })),
}))

describe('AuthGuard Component', () => {
  let mockUseAuth: any

  beforeEach(() => {
    const { useAuth } = require('@/composables/useAuth')
    mockUseAuth = useAuth()
    vi.clearAllMocks()
  })

  it('should render login form when not authenticated', () => {
    mockUseAuth.isAuthenticated.value = false
    mockUseAuth.authRequired.value = true

    const wrapper = mount(AuthGuard, {
      slots: {
        default: '<div>Protected Content</div>',
      },
    })

    expect(wrapper.text()).toContain('Access Key Required')
    expect(wrapper.text()).not.toContain('Protected Content')
  })

  it('should render protected content when authenticated', () => {
    mockUseAuth.isAuthenticated.value = true
    mockUseAuth.authRequired.value = true

    const wrapper = mount(AuthGuard, {
      slots: {
        default: '<div>Protected Content</div>',
      },
    })

    expect(wrapper.text()).toContain('Protected Content')
    expect(wrapper.text()).not.toContain('Access Key Required')
  })

  it('should render protected content when auth is not required', () => {
    mockUseAuth.isAuthenticated.value = false
    mockUseAuth.authRequired.value = false

    const wrapper = mount(AuthGuard, {
      slots: {
        default: '<div>Protected Content</div>',
      },
    })

    expect(wrapper.text()).toContain('Protected Content')
  })

  it('should show loading state when checking auth', () => {
    mockUseAuth.isAuthenticated.value = false
    mockUseAuth.authRequired.value = true
    mockUseAuth.isChecking.value = true

    const wrapper = mount(AuthGuard, {
      slots: {
        default: '<div>Protected Content</div>',
      },
    })

    expect(wrapper.text()).toContain('Loading')
  })

  it('should call initialize on mount', () => {
    const initializeSpy = vi.fn()
    mockUseAuth.initialize = initializeSpy

    mount(AuthGuard, {
      slots: {
        default: '<div>Protected Content</div>',
      },
    })

    expect(initializeSpy).toHaveBeenCalled()
  })

  it('should call login when form is submitted', async () => {
    const loginSpy = vi.fn().mockResolvedValue(true)
    mockUseAuth.login = loginSpy
    mockUseAuth.isAuthenticated.value = false
    mockUseAuth.authRequired.value = true

    const wrapper = mount(AuthGuard, {
      slots: {
        default: '<div>Protected Content</div>',
      },
    })

    const input = wrapper.find('input[type="password"]')
    await input.setValue('test-key')

    const form = wrapper.find('form')
    await form.trigger('submit')

    expect(loginSpy).toHaveBeenCalledWith('test-key')
  })

  it('should display error message when login fails', async () => {
    mockUseAuth.error.value = 'Invalid access key'
    mockUseAuth.isAuthenticated.value = false
    mockUseAuth.authRequired.value = true

    const wrapper = mount(AuthGuard, {
      slots: {
        default: '<div>Protected Content</div>',
      },
    })

    await nextTick()

    expect(wrapper.text()).toContain('Invalid access key')
  })
})

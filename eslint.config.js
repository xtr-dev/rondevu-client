import js from '@eslint/js'
import tsPlugin from '@typescript-eslint/eslint-plugin'
import tsParser from '@typescript-eslint/parser'
import prettierConfig from 'eslint-config-prettier'
import prettierPlugin from 'eslint-plugin-prettier'
import unicorn from 'eslint-plugin-unicorn'
import globals from 'globals'

export default [
    js.configs.recommended,
    {
        files: ['**/*.ts', '**/*.tsx', '**/*.js'],
        languageOptions: {
            parser: tsParser,
            parserOptions: {
                ecmaVersion: 'latest',
                sourceType: 'module',
            },
            globals: {
                ...globals.browser,
                ...globals.node,
                // WebRTC globals
                RTCPeerConnection: 'readonly',
                RTCIceCandidate: 'readonly',
                RTCSessionDescription: 'readonly',
                RTCSessionDescriptionInit: 'readonly',
                RTCIceCandidateInit: 'readonly',
                RTCConfiguration: 'readonly',
                RTCIceServer: 'readonly',
                RTCIceTransportPolicy: 'readonly',
                RTCIceConnectionState: 'readonly',
                RTCIceGatheringState: 'readonly',
                RTCPeerConnectionState: 'readonly',
                RTCDataChannel: 'readonly',
                BufferSource: 'readonly',
            },
        },
        plugins: {
            '@typescript-eslint': tsPlugin,
            prettier: prettierPlugin,
            unicorn: unicorn,
        },
        rules: {
            ...tsPlugin.configs.recommended.rules,
            ...prettierConfig.rules,
            'prettier/prettier': 'error',
            '@typescript-eslint/no-explicit-any': 'off',
            '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
            'unicorn/filename-case': [
                'error',
                {
                    case: 'kebabCase',
                    ignore: ['^README\\.md$'],
                },
            ],
        },
    },
    {
        ignores: ['dist/**', 'node_modules/**', '*.config.js'],
    },
]

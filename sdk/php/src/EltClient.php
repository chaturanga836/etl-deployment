<?php

declare(strict_types=1);

namespace Elt\Sdk;

use RuntimeException;

final class EltClient
{
    private string $baseUrl;

    /** @var callable(): ?string|null */
    private $getAccessToken;

    public function __construct(string $baseUrl, ?callable $getAccessToken = null)
    {
        $this->baseUrl = rtrim($baseUrl, '/');
        $this->getAccessToken = $getAccessToken;
    }

    /** @return array<string, mixed> */
    public function signup(string $email, string $password, string $orgName): array
    {
        return $this->request('POST', '/api/v1/auth/signup', [
            'email' => $email,
            'password' => $password,
            'org_name' => $orgName,
        ]);
    }

    /** @return array<string, mixed> */
    public function getAccount(): array
    {
        return $this->request('GET', '/api/v1/studio/account');
    }

    /** @return array<string, mixed> */
    public function listProjects(?int $orgId = null): array
    {
        $path = '/api/v1/studio/projects';
        if ($orgId !== null) {
            $path .= '?org_id=' . $orgId;
        }
        return $this->request('GET', $path);
    }

    /** @param array<string, mixed> $body */
    public function createProject(array $body, ?int $orgId = null): array
    {
        $path = '/api/v1/studio/projects';
        if ($orgId !== null) {
            $path .= '?org_id=' . $orgId;
        }
        return $this->request('POST', $path, $body);
    }

    /** @return list<mixed> */
    public function listServices(bool $availableOnly = false): array
    {
        $path = '/api/v1/studio/services';
        if ($availableOnly) {
            $path .= '?available_only=true';
        }
        return $this->request('GET', $path);
    }

    /** @return array<string, mixed> */
    public function listWorkspaces(): array
    {
        return $this->request('GET', '/api/v1/workspaces/');
    }

    /** @param array<string, mixed>|null $body @return mixed */
    private function request(string $method, string $path, ?array $body = null)
    {
        $url = $this->baseUrl . $path;
        $headers = ['Content-Type: application/json'];
        if ($this->getAccessToken !== null) {
            $token = ($this->getAccessToken)();
            if ($token !== null && $token !== '') {
                $headers[] = 'Authorization: Bearer ' . $token;
            }
        }

        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_CUSTOMREQUEST => $method,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HTTPHEADER => $headers,
            CURLOPT_TIMEOUT => 30,
        ]);
        if ($body !== null) {
            curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body, JSON_THROW_ON_ERROR));
        }

        $response = curl_exec($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        if ($response === false) {
            throw new RuntimeException('ELT API request failed: ' . curl_error($ch));
        }
        curl_close($ch);

        if ($status >= 400) {
            throw new RuntimeException("ELT API {$method} {$path} failed ({$status}): {$response}");
        }
        if ($status === 204 || $response === '') {
            return [];
        }
        return json_decode($response, true, 512, JSON_THROW_ON_ERROR);
    }
}

import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Collapse,
  Descriptions,
  Form,
  Input,
  InputNumber,
  Layout,
  Radio,
  Result,
  Space,
  Steps,
  Typography,
  message,
} from 'antd';
import {
  defaultWizard,
  fetchHostInfo,
  fetchInstallDefaults,
  fetchInstallState,
  fetchPrerequisites,
  requestTrialLicense,
  startDeploy,
  validateDatabase,
  validateLicense,
  type HostInfo,
  type InstallDefaults,
  type Prerequisites,
  type WizardState,
} from './api';
import { useDeployEvents } from './useDeployEvents';

const { Header, Content } = Layout;
const { Title, Paragraph, Text, Link } = Typography;

/** User-visible steps (internal step 2 = packages, skipped in navigation). */
const USER_STEP_LABELS = [
  'Welcome',
  'Install type',
  'Your account',
  'Database',
  'Trial',
  'Web address',
  'Confirm',
  'Installing',
  'Done',
];

function userStepIndex(internal: number): number {
  return internal <= 1 ? internal : internal - 1;
}

function skipPackagesStep(internal: number, delta: number): number {
  let n = internal + delta;
  if (delta > 0 && n === 2) n = 3;
  if (delta < 0 && n === 2) n = 1;
  return Math.max(0, Math.min(n, 9));
}

export default function App() {
  const [step, setStep] = useState(0);
  const [wizard, setWizard] = useState<WizardState>(defaultWizard);
  const [prereqs, setPrereqs] = useState<Prerequisites | null>(null);
  const [hostInfo, setHostInfo] = useState<HostInfo | null>(null);
  const [installDefaults, setInstallDefaults] = useState<InstallDefaults | null>(null);
  const [trialInfo, setTrialInfo] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [loginUrl, setLoginUrl] = useState('');
  const [deployError, setDeployError] = useState('');
  const [alreadyInstalled, setAlreadyInstalled] = useState<{ login_url?: string } | null>(null);

  const onComplete = useCallback((url: string) => {
    setLoginUrl(url);
    setStep(9);
  }, []);
  const onError = useCallback((msg: string) => {
    setDeployError(msg);
    message.error(msg);
  }, []);

  const { logs, phase, bottomRef } = useDeployEvents(jobId, onComplete, onError);

  useEffect(() => {
    fetchPrerequisites().then(setPrereqs).catch(() => {});
    fetchInstallDefaults().then((defaults) => {
      setInstallDefaults(defaults);
      setWizard((w) => ({
        ...w,
        registry_url: defaults.registry_url,
        image_tag: defaults.image_tag,
        app_name: defaults.app_name,
      }));
    }).catch(() => {});
    fetchHostInfo().then((info) => {
      setHostInfo(info);
      setWizard((w) => ({
        ...w,
        monolith: {
          ...w.monolith,
          public_host: w.monolith.public_host === 'localhost'
            ? info.suggested_public_host
            : w.monolith.public_host,
        },
        kubernetes: {
          ...w.kubernetes,
          ingress_host: w.kubernetes.ingress_host === 'studio.example.com'
            ? info.suggested_public_host
            : w.kubernetes.ingress_host,
        },
      }));
    }).catch(() => {});
    fetchInstallState().then((s) => {
      if (s.installed) {
        setAlreadyInstalled(s);
        setLoginUrl(s.login_url || '');
        setStep(9);
      }
    });
  }, []);

  const update = (patch: Partial<WizardState>) => setWizard((w) => ({ ...w, ...patch }));

  const next = async () => {
    if (step === 5 && wizard.license_key) {
      try {
        await validateLicense(wizard.license_key);
      } catch (e) {
        message.error(e instanceof Error ? e.message : 'Invalid license');
        return;
      }
    }
    if (step === 8) return;
    setStep((s) => skipPackagesStep(s, 1));
  };

  const back = () => setStep((s) => skipPackagesStep(s, -1));

  const runDeploy = async () => {
    setDeployError('');
    try {
      const id = await startDeploy(wizard);
      setJobId(id);
      setStep(8);
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Install failed');
    }
  };

  const testDb = async () => {
    try {
      await validateDatabase(wizard.database);
      message.success('Database connection successful');
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Connection failed');
    }
  };

  const siteUrl = hostInfo?.platform_url
    ?? (wizard.monolith.public_host ? `http://${wizard.monolith.public_host}` : '');

  const renderStep = () => {
    switch (step) {
      case 0:
        return (
          <Card title="Welcome">
            <Paragraph>
              This guide will install <Text strong>DT Orch</Text>
              {installDefaults ? ` version ${installDefaults.platform_version}` : ''} on this server.
              Answer a few questions, then click <Text strong>Install</Text>.
            </Paragraph>
            {siteUrl && (
              <Alert
                type="info"
                showIcon
                style={{ marginBottom: 16 }}
                message="After installation"
                description={
                  <Text>
                    You will open your platform at{' '}
                    <Link href={`${siteUrl.replace(/\/$/, '')}/login`} target="_blank" rel="noreferrer">
                      {siteUrl.replace(/\/$/, '')}/login
                    </Link>
                  </Text>
                }
              />
            )}
            {!prereqs?.docker.available && (
              <Alert type="warning" message="Docker must be installed on this server before you continue." style={{ marginTop: 16 }} />
            )}
            {prereqs && (
              <Collapse
                ghost
                style={{ marginTop: 8 }}
                items={[{
                  key: 'sys',
                  label: 'Technical system check',
                  children: (
                    <Space direction="vertical">
                      <Text>Docker: {prereqs.docker.available ? prereqs.docker.version : 'Not found'}</Text>
                      <Text>Compose: {prereqs.compose.available ? prereqs.compose.version : 'Not found'}</Text>
                    </Space>
                  ),
                }]}
              />
            )}
          </Card>
        );
      case 1:
        return (
          <Card title="How do you want to install?">
            <Radio.Group
              value={wizard.deployment_mode}
              onChange={(e) => update({ deployment_mode: e.target.value })}
            >
              <Space direction="vertical" size="middle">
                <Radio value="monolith">
                  <Text strong>Single server</Text>
                  <br />
                  <Text type="secondary">Recommended — everything on this machine.</Text>
                </Radio>
                <Radio value="distributed" disabled>
                  <Text strong>Multiple servers</Text>
                  <br />
                  <Text type="secondary">For advanced setups (coming soon in this wizard).</Text>
                </Radio>
                <Radio value="kubernetes" disabled>
                  <Text strong>Kubernetes</Text>
                  <br />
                  <Text type="secondary">For advanced setups (coming soon in this wizard).</Text>
                </Radio>
              </Space>
            </Radio.Group>
          </Card>
        );
      case 3:
        return (
          <Card title="Your administrator account">
            <Paragraph type="secondary">
              You will use this to sign in after installation.
            </Paragraph>
            <Form layout="vertical">
              <Form.Item label="Username" required>
                <Input value={wizard.superadmin_username} onChange={(e) => update({ superadmin_username: e.target.value })} />
              </Form.Item>
              <Form.Item label="Password" required>
                <Input.Password value={wizard.superadmin_password} onChange={(e) => update({ superadmin_password: e.target.value })} />
              </Form.Item>
              <Form.Item label="Email (optional)">
                <Input value={wizard.superadmin_email} onChange={(e) => update({ superadmin_email: e.target.value })} />
              </Form.Item>
            </Form>
          </Card>
        );
      case 4:
        return (
          <Card title="Database">
            <Radio.Group
              value={wizard.database.source}
              onChange={(e) => update({ database: { ...wizard.database, source: e.target.value } })}
              style={{ marginBottom: 16 }}
            >
              <Space direction="vertical">
                <Radio value="bundled">
                  <Text strong>Install database for me</Text>
                  <br />
                  <Text type="secondary">Recommended for a new server.</Text>
                </Radio>
                <Radio value="external">
                  <Text strong>Use my existing database</Text>
                </Radio>
              </Space>
            </Radio.Group>
            {wizard.database.source === 'external' && (
              <Form layout="vertical">
                <Form.Item label="Host">
                  <Input value={wizard.database.host} onChange={(e) => update({ database: { ...wizard.database, host: e.target.value } })} />
                </Form.Item>
                <Form.Item label="Port">
                  <InputNumber value={wizard.database.port} onChange={(v) => update({ database: { ...wizard.database, port: v || 5432 } })} style={{ width: '100%' }} />
                </Form.Item>
                <Form.Item label="Username">
                  <Input value={wizard.database.user} onChange={(e) => update({ database: { ...wizard.database, user: e.target.value } })} />
                </Form.Item>
                <Form.Item label="Password">
                  <Input.Password value={wizard.database.password} onChange={(e) => update({ database: { ...wizard.database, password: e.target.value } })} />
                </Form.Item>
                <Button onClick={testDb}>Test connection</Button>
              </Form>
            )}
          </Card>
        );
      case 5:
        return (
          <Card title="Trial">
            <Paragraph>
              Start with a <Text strong>3-month free trial</Text>. No license key is required.
            </Paragraph>
            <Button type="primary" size="large" onClick={async () => {
              try {
                const trial = await requestTrialLicense();
                update({ license_key: trial.license_key });
                setTrialInfo(`Trial active until ${trial.expires_at?.slice(0, 10) ?? '—'}`);
                message.success('Free trial ready');
              } catch (e) {
                message.error(e instanceof Error ? e.message : 'Could not start trial');
              }
            }}>
              Activate free trial
            </Button>
            {trialInfo && <Paragraph style={{ marginTop: 12 }}><Text type="success">{trialInfo}</Text></Paragraph>}
            <Collapse
              ghost
              style={{ marginTop: 16 }}
              items={[{
                key: 'license',
                label: 'I already have a license key',
                children: (
                  <Form layout="vertical">
                    <Form.Item label="License key">
                      <Input.TextArea rows={3} value={wizard.license_key} onChange={(e) => update({ license_key: e.target.value })} />
                    </Form.Item>
                    {wizard.license_key && (
                      <Button onClick={async () => {
                        try {
                          await validateLicense(wizard.license_key);
                          message.success('License accepted');
                        } catch (e) {
                          message.error(e instanceof Error ? e.message : 'Invalid license');
                        }
                      }}>Check license</Button>
                    )}
                  </Form>
                ),
              }]}
            />
            <Paragraph type="secondary" style={{ marginTop: 12 }}>
              If you skip this page, a trial is applied automatically when you install.
            </Paragraph>
          </Card>
        );
      case 6:
        if (wizard.deployment_mode === 'monolith') {
          return (
            <Card title="Your website address">
              <Paragraph type="secondary">
                Enter the address people will use to open DT Orch in a browser (usually this server&apos;s public IP or domain name).
              </Paragraph>
              <Form layout="vertical">
                <Form.Item label="Address" extra="Example: 13.200.160.10 or studio.mycompany.com">
                  <Input
                    value={wizard.monolith.public_host}
                    onChange={(e) => update({ monolith: { ...wizard.monolith, public_host: e.target.value } })}
                    placeholder="13.200.160.10"
                  />
                </Form.Item>
              </Form>
            </Card>
          );
        }
        if (wizard.deployment_mode === 'kubernetes') {
          return (
            <Card title="Kubernetes settings">
              <Form layout="vertical">
                <Form.Item label="Namespace">
                  <Input value={wizard.kubernetes.namespace} onChange={(e) => update({ kubernetes: { ...wizard.kubernetes, namespace: e.target.value } })} />
                </Form.Item>
                <Form.Item label="Ingress host" required>
                  <Input value={wizard.kubernetes.ingress_host} onChange={(e) => update({ kubernetes: { ...wizard.kubernetes, ingress_host: e.target.value } })} />
                </Form.Item>
              </Form>
            </Card>
          );
        }
        return (
          <Card title="Server addresses">
            <Form layout="vertical">
              {Object.entries(wizard.distributed.services).map(([name, svc]) => (
                <Form.Item key={name} label={name}>
                  <Input
                    value={svc.host}
                    onChange={(e) => update({
                      distributed: {
                        services: {
                          ...wizard.distributed.services,
                          [name]: { ...svc, host: e.target.value },
                        },
                      },
                    })}
                  />
                </Form.Item>
              ))}
            </Form>
          </Card>
        );
      case 7:
        return (
          <Card title="Ready to install">
            <Descriptions bordered column={1} size="middle">
              <Descriptions.Item label="Product">{wizard.app_name}</Descriptions.Item>
              <Descriptions.Item label="Version">{installDefaults?.platform_version ?? wizard.image_tag.replace(/^v/, '')}</Descriptions.Item>
              <Descriptions.Item label="Install type">Single server</Descriptions.Item>
              <Descriptions.Item label="Administrator">{wizard.superadmin_username || '—'}</Descriptions.Item>
              <Descriptions.Item label="Database">
                {wizard.database.source === 'bundled' ? 'Included with install' : 'Your existing database'}
              </Descriptions.Item>
              <Descriptions.Item label="Trial">
                {wizard.license_key ? 'License / trial ready' : '3-month trial (at install)'}
              </Descriptions.Item>
              <Descriptions.Item label="Website">
                {wizard.monolith.public_host
                  ? `http://${wizard.monolith.public_host}`
                  : '—'}
              </Descriptions.Item>
            </Descriptions>
            <Button type="primary" size="large" onClick={runDeploy} style={{ marginTop: 24 }}>
              Install DT Orch
            </Button>
          </Card>
        );
      case 8:
        return (
          <Card title="Installing…">
            <Paragraph>Please wait while DT Orch is installed. This may take several minutes.</Paragraph>
            {phase && <Alert message={`Step: ${phase}`} type="info" style={{ marginBottom: 12 }} />}
            {deployError && <Alert message={deployError} type="error" style={{ marginBottom: 12 }} />}
            <div style={{
              background: '#1e1e1e',
              color: '#d4d4d4',
              fontFamily: 'monospace',
              fontSize: 12,
              padding: 12,
              height: 360,
              overflow: 'auto',
              borderRadius: 8,
            }}>
              {logs.map((line, i) => (
                <div key={i}>{line}</div>
              ))}
              <div ref={bottomRef} />
            </div>
          </Card>
        );
      case 9:
        return (
          <Result
            status="success"
            title="DT Orch is ready"
            subTitle={alreadyInstalled ? 'DT Orch is already installed on this server.' : 'You can sign in now.'}
            extra={[
              <Paragraph key="u">
                Open:{' '}
                <Link href={loginUrl} target="_blank" rel="noreferrer">{loginUrl || '/login'}</Link>
              </Paragraph>,
              <Paragraph key="a">Administrator: <Text strong>{wizard.superadmin_username || '—'}</Text></Paragraph>,
              <Button type="primary" key="go" href={loginUrl || '/login'}>Open DT Orch</Button>,
            ]}
          />
        );
      default:
        return null;
    }
  };

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Header style={{ background: '#001529', padding: '0 24px' }}>
        <Title level={3} style={{ color: '#fff', margin: '16px 0' }}>DT Orch Setup</Title>
      </Header>
      <Content style={{ padding: 24, maxWidth: 960, margin: '0 auto', width: '100%' }}>
        <Steps
          current={userStepIndex(step)}
          items={USER_STEP_LABELS.map((t) => ({ title: t }))}
          style={{ marginBottom: 24 }}
          responsive={false}
        />
        {renderStep()}
        {step > 0 && step < 8 && step !== 7 && (
          <Space style={{ marginTop: 16 }}>
            <Button onClick={back}>Back</Button>
            <Button type="primary" onClick={next}>Next</Button>
          </Space>
        )}
        {step === 0 && (
          <Button type="primary" onClick={next} style={{ marginTop: 16 }} size="large">Get started</Button>
        )}
      </Content>
    </Layout>
  );
}

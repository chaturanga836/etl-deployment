import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Checkbox,
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

const STEP_LABELS = [
  'Welcome',
  'Target',
  'Packages',
  'Super Admin',
  'Database',
  'License',
  'Config',
  'Review',
  'Deploy',
  'Complete',
];

export default function App() {
  const [step, setStep] = useState(0);
  const [wizard, setWizard] = useState<WizardState>(defaultWizard);
  const [prereqs, setPrereqs] = useState<Prerequisites | null>(null);
  const [hostInfo, setHostInfo] = useState<HostInfo | null>(null);
  const [installDefaults, setInstallDefaults] = useState<InstallDefaults | null>(null);
  const [showAdvancedRegistry, setShowAdvancedRegistry] = useState(false);
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
    fetchPrerequisites().then(setPrereqs).catch(() => message.error('Could not load prerequisites'));
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
    setStep((s) => Math.min(s + 1, 9));
  };

  const back = () => setStep((s) => Math.max(s - 1, 0));

  const runDeploy = async () => {
    setDeployError('');
    try {
      const id = await startDeploy(wizard);
      setJobId(id);
      setStep(8);
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Deploy failed');
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

  const renderStep = () => {
    switch (step) {
      case 0:
        return (
          <Card title="Welcome to DT Orch Setup">
            <Paragraph>
              Configure and install DT Orch entirely in this wizard. You do not need to edit
              <Text code>.env</Text> files manually — settings are saved and applied when you click Install.
            </Paragraph>
            {hostInfo && (
              <Alert
                type="info"
                showIcon
                style={{ marginBottom: 16 }}
                message="Open this setup page"
                description={
                  <Space direction="vertical">
                    <Text>
                      Installer URL: <Link href={hostInfo.installer_url} target="_blank" rel="noreferrer">{hostInfo.installer_url}</Link>
                    </Text>
                    <Text type="secondary">
                      After install, the platform will be at {hostInfo.platform_url}
                    </Text>
                    <Text type="secondary">
                      EC2 security group: allow inbound TCP {hostInfo.security_group_ports.join(' and ')}
                    </Text>
                  </Space>
                }
              />
            )}
            <Paragraph>
              Steps: deployment target → official packages → super admin → database →
              license (optional trial) → host settings → review → install.
            </Paragraph>
            {prereqs && (
              <Space direction="vertical">
                <Text>Docker: {prereqs.docker.available ? prereqs.docker.version : 'Not found'}</Text>
                <Text>Compose: {prereqs.compose.available ? prereqs.compose.version : 'Not found'}</Text>
                <Text>Helm: {prereqs.helm.available ? prereqs.helm.version : 'Not found'}</Text>
                <Text>kubectl: {prereqs.kubectl.available ? prereqs.kubectl.version : 'Not found'}</Text>
              </Space>
            )}
            {!prereqs?.docker.available && (
              <Alert type="warning" message="Docker is required for monolith and distributed installs." style={{ marginTop: 16 }} />
            )}
          </Card>
        );
      case 1:
        return (
          <Card title="Deployment target">
            <Radio.Group
              value={wizard.deployment_mode}
              onChange={(e) => update({ deployment_mode: e.target.value })}
            >
              <Space direction="vertical">
                <Radio value="monolith">Monolith — single VM with Docker Compose</Radio>
                <Radio value="distributed">Distributed — multi-VM roles</Radio>
                <Radio value="kubernetes">Kubernetes — Helm chart</Radio>
              </Space>
            </Radio.Group>
          </Card>
        );
      case 2:
        return (
          <Card title="Official DT Orch packages">
            <Alert
              type="success"
              showIcon
              message="Pre-configured for this install"
              description={installDefaults?.description ?? 'Official release packages are selected automatically. Click Next to continue.'}
              style={{ marginBottom: 16 }}
            />
            <Descriptions bordered size="small" column={1} style={{ marginBottom: 16 }}>
              <Descriptions.Item label="Product">{wizard.app_name}</Descriptions.Item>
              <Descriptions.Item label="Version">{installDefaults?.platform_version ?? wizard.image_tag.replace(/^v/, '')}</Descriptions.Item>
              <Descriptions.Item label="Release">{wizard.image_tag}</Descriptions.Item>
            </Descriptions>
            {installDefaults?.images && (
              <Descriptions bordered size="small" column={1} title="Components" style={{ marginBottom: 16 }}>
                {installDefaults.images.map((img) => (
                  <Descriptions.Item key={img.role} label={img.role}>
                    <Text code style={{ fontSize: 11 }}>{img.reference}</Text>
                  </Descriptions.Item>
                ))}
              </Descriptions>
            )}
            <Paragraph type="secondary">
              You do not need to enter registry details. Only change these if your vendor gave you a private mirror.
            </Paragraph>
            <Collapse
              ghost
              activeKey={showAdvancedRegistry ? ['advanced'] : []}
              onChange={(keys) => setShowAdvancedRegistry(keys.includes('advanced'))}
              items={[{
                key: 'advanced',
                label: 'Advanced: custom registry (optional)',
                children: (
                  <Form layout="vertical">
                    <Form.Item label="Registry URL">
                      <Input value={wizard.registry_url} onChange={(e) => update({ registry_url: e.target.value })} />
                    </Form.Item>
                    <Form.Item label="Image tag">
                      <Input value={wizard.image_tag} onChange={(e) => update({ image_tag: e.target.value })} />
                    </Form.Item>
                    <Form.Item label="Application name">
                      <Input value={wizard.app_name} onChange={(e) => update({ app_name: e.target.value })} />
                    </Form.Item>
                  </Form>
                ),
              }]}
            />
          </Card>
        );
      case 3:
        return (
          <Card title="Super Admin account">
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
              <Radio value="bundled">Self-deploy (bundled Postgres)</Radio>
              <Radio value="external">Connect to existing database</Radio>
            </Radio.Group>
            <Form layout="vertical">
              <Form.Item label="DB user">
                <Input value={wizard.database.user} onChange={(e) => update({ database: { ...wizard.database, user: e.target.value } })} />
              </Form.Item>
              <Form.Item label="DB password">
                <Input.Password value={wizard.database.password} onChange={(e) => update({ database: { ...wizard.database, password: e.target.value } })} />
              </Form.Item>
              {wizard.database.source === 'external' && (
                <>
                  <Form.Item label="Host">
                    <Input value={wizard.database.host} onChange={(e) => update({ database: { ...wizard.database, host: e.target.value } })} />
                  </Form.Item>
                  <Form.Item label="Port">
                    <InputNumber value={wizard.database.port} onChange={(v) => update({ database: { ...wizard.database, port: v || 5432 } })} style={{ width: '100%' }} />
                  </Form.Item>
                  <Button onClick={testDb}>Test connection</Button>
                </>
              )}
            </Form>
          </Card>
        );
      case 5:
        return (
          <Card title="License">
            <Paragraph>
              Start a <Text strong>3-month free trial</Text> or paste a license key from your vendor.
              If you skip this step, a trial license is applied automatically at install time.
            </Paragraph>
            <Form layout="vertical">
              <Space style={{ marginBottom: 16 }}>
                <Button type="primary" onClick={async () => {
                  try {
                    const trial = await requestTrialLicense();
                    update({ license_key: trial.license_key });
                    setTrialInfo(`Trial active until ${trial.expires_at?.slice(0, 10) ?? '—'}`);
                    message.success(`3-month trial started (${trial.customer_id})`);
                  } catch (e) {
                    message.error(e instanceof Error ? e.message : 'Trial failed');
                  }
                }}>
                  Start 3-month trial
                </Button>
                {trialInfo && <Text type="success">{trialInfo}</Text>}
              </Space>
              <Form.Item label="License key (optional if using trial)">
                <Input.TextArea rows={4} value={wizard.license_key} onChange={(e) => update({ license_key: e.target.value })} placeholder="Leave empty to auto-apply trial at install" />
              </Form.Item>
              {wizard.license_key && (
                <Button onClick={async () => {
                  try {
                    const info = await validateLicense(wizard.license_key);
                    message.success(`Valid — customer ${info.customer_id}, edition ${info.edition}`);
                  } catch (e) {
                    message.error(e instanceof Error ? e.message : 'Invalid');
                  }
                }}>Validate license</Button>
              )}
            </Form>
          </Card>
        );
      case 6:
        if (wizard.deployment_mode === 'monolith') {
          return (
            <Card title="Monolith settings">
              <Form layout="vertical">
                <Form.Item label="Public host" extra="Detected from this server; used for login URLs after install">
                  <Input value={wizard.monolith.public_host} onChange={(e) => update({ monolith: { ...wizard.monolith, public_host: e.target.value } })} />
                </Form.Item>
                <Form.Item label="HTTP port">
                  <InputNumber value={wizard.monolith.http_port} onChange={(v) => update({ monolith: { ...wizard.monolith, http_port: v || 80 } })} style={{ width: '100%' }} />
                </Form.Item>
                <Form.Item>
                  <Checkbox checked={wizard.monolith.use_proxy} onChange={(e) => update({ monolith: { ...wizard.monolith, use_proxy: e.target.checked } })}>Use nginx reverse proxy</Checkbox>
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
                <Form.Item label="Kubeconfig path (optional)">
                  <Input value={wizard.kubernetes.kubeconfig_path} onChange={(e) => update({ kubernetes: { ...wizard.kubernetes, kubeconfig_path: e.target.value } })} placeholder="/root/.kube/config" />
                </Form.Item>
              </Form>
            </Card>
          );
        }
        return (
          <Card title="Distributed hosts">
            <Form layout="vertical">
              {Object.entries(wizard.distributed.services).map(([name, svc]) => (
                <Form.Item key={name} label={name}>
                  <Input
                    addonBefore="host"
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
              <Title level={5}>SSH (remote hosts)</Title>
              <Form.Item label="SSH user">
                <Input value={wizard.ssh.user} onChange={(e) => update({ ssh: { ...wizard.ssh, user: e.target.value } })} />
              </Form.Item>
              <Form.Item label="SSH private key path">
                <Input value={wizard.ssh.key_path} onChange={(e) => update({ ssh: { ...wizard.ssh, key_path: e.target.value } })} />
              </Form.Item>
            </Form>
          </Card>
        );
      case 7:
        return (
          <Card title="Review">
            <pre style={{ background: '#f5f5f5', padding: 16, borderRadius: 8, overflow: 'auto' }}>
              {JSON.stringify({
                mode: wizard.deployment_mode,
                product: wizard.app_name,
                version: wizard.image_tag,
                superadmin: wizard.superadmin_username,
                database: wizard.database.source,
                license: wizard.license_key ? '(set)' : '(3-month trial at install)',
              }, null, 2)}
            </pre>
            <Button type="primary" size="large" onClick={runDeploy} style={{ marginTop: 16 }}>
              Start deployment
            </Button>
          </Card>
        );
      case 8:
        return (
          <Card title="Deploying…">
            {phase && <Alert message={`Phase: ${phase}`} type="info" style={{ marginBottom: 12 }} />}
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
            title="Installation complete"
            subTitle={alreadyInstalled ? 'DT Orch is already installed on this host.' : 'Your platform is ready.'}
            extra={[
              <Paragraph key="u">
                Login URL:{' '}
                <Link href={loginUrl} target="_blank" rel="noreferrer">{loginUrl || '/login'}</Link>
              </Paragraph>,
              <Paragraph key="a">Super admin: <Text code>{wizard.superadmin_username || '(see install state)'}</Text></Paragraph>,
              <Button type="primary" key="go" href={loginUrl || '/login'}>Open login page</Button>,
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
        <Steps current={step} items={STEP_LABELS.map((t) => ({ title: t }))} style={{ marginBottom: 24 }} responsive={false} />
        {renderStep()}
        {step > 0 && step < 8 && step !== 7 && (
          <Space style={{ marginTop: 16 }}>
            <Button onClick={back}>Back</Button>
            <Button type="primary" onClick={next}>Next</Button>
          </Space>
        )}
        {step === 0 && (
          <Button type="primary" onClick={next} style={{ marginTop: 16 }}>Get started</Button>
        )}
      </Content>
    </Layout>
  );
}

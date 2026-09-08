"use client";

import {
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  Eye,
  EyeOff,
} from "lucide-react";

import {
  type IqCredentialProfile,
  createIqCredentialProfile,
  deactivateIqCredentialProfile,
  listIqCredentialProfiles,
  testIqConnection,
} from "@/services/iq";

const DEFAULT_IQ_ERP_URL =
  "https://sistema-3-erp.vercel.app";

function panelStyle(): React.CSSProperties {
  return {
    border:
      "1px solid rgba(148, 163, 184, 0.25)",
    borderRadius: 16,
    padding: 18,
    background:
      "rgba(15, 23, 42, 0.72)",
    boxShadow:
      "0 18px 50px rgba(0,0,0,0.22)",
  };
}

function inputStyle(): React.CSSProperties {
  return {
    width: "100%",
    border:
      "1px solid rgba(148, 163, 184, 0.35)",
    borderRadius: 10,
    padding: "10px 12px",
    background:
      "rgba(2, 6, 23, 0.72)",
    color: "white",
    outline: "none",
  };
}

function buttonStyle(
  primary = false,
): React.CSSProperties {
  return {
    border:
      "1px solid rgba(148, 163, 184, 0.35)",
    borderRadius: 10,
    padding: "10px 12px",
    background: primary
      ? "rgba(59, 130, 246, 0.92)"
      : "rgba(15, 23, 42, 0.92)",
    color: "white",
    cursor: "pointer",
  };
}

export default function IqIntegrationPage() {
  const [
    profiles,
    setProfiles,
  ] = useState<IqCredentialProfile[]>([]);

  const [
    loading,
    setLoading,
  ] = useState(true);

  const [
    saving,
    setSaving,
  ] = useState(false);

  const [
    alias,
    setAlias,
  ] = useState("");

  const [
    username,
    setUsername,
  ] = useState("");

  const [
    password,
    setPassword,
  ] = useState("");

  const [
    showPassword,
    setShowPassword,
  ] = useState(false);

  const [
    erpUrl,
    setErpUrl,
  ] = useState(
    DEFAULT_IQ_ERP_URL,
  );

  const [
    message,
    setMessage,
  ] = useState<string | null>(
    null,
  );

  const activeCount = useMemo(
    () =>
      profiles.filter(
        (profile) =>
          profile.active,
      ).length,
    [profiles],
  );

  async function loadData() {
    setLoading(true);
    setMessage(null);

    try {
      const profileList =
        await listIqCredentialProfiles();

      setProfiles(profileList);
    } catch (error) {
      const err = error as Error;

      setMessage(
        err.message ||
          "No se pudieron cargar las cuentas IQ.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
  }, []);

  async function onCreateProfile() {
    if (
      !alias.trim() ||
      !username.trim()
    ) {
      setMessage(
        "Captura alias y usuario IQ.",
      );
      return;
    }

    setSaving(true);
    setMessage(null);

    try {
      await createIqCredentialProfile({
        alias: alias.trim(),
        username:
          username.trim(),
        password:
          password.trim() ||
          undefined,
        erpUrl:
          erpUrl.trim() ||
          DEFAULT_IQ_ERP_URL,
      });

      setAlias("");
      setUsername("");
      setPassword("");

      setMessage(
        "Cuenta IQ creada.",
      );

      await loadData();
    } catch (error) {
      const err = error as Error;

      setMessage(
        err.message ||
          "No se pudo crear la cuenta IQ.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function onDeactivateProfile(
    profileId: string,
  ) {
    setSaving(true);
    setMessage(null);

    try {
      await deactivateIqCredentialProfile(
        profileId,
      );

      setMessage(
        "Cuenta IQ desactivada.",
      );

      await loadData();
    } catch (error) {
      const err = error as Error;

      setMessage(
        err.message ||
          "No se pudo desactivar la cuenta IQ.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function onTestProfile(
    profileId: string,
  ) {
    setSaving(true);
    setMessage(null);

    try {
      const result =
        await testIqConnection(
          profileId,
        );

      setMessage(result.message);

      await loadData();
    } catch (error) {
      const err = error as Error;

      setMessage(
        err.message ||
          "No se pudo probar la cuenta IQ.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <main
      style={{
        padding: 24,
        color: "white",
      }}
    >
      <div
        style={{
          maxWidth: 1180,
          margin: "0 auto",
          display: "grid",
          gap: 18,
        }}
      >
        <header
          style={{
            display: "grid",
            gap: 8,
          }}
        >
          <p
            style={{
              margin: 0,
              color:
                "rgba(148, 163, 184, 0.95)",
              fontSize: 13,
            }}
          >
            Integraciones
          </p>

          <h1
            style={{
              margin: 0,
              fontSize: 28,
            }}
          >
            Conexion IQ
          </h1>

          <p
            style={{
              margin: 0,
              color:
                "rgba(203, 213, 225, 0.86)",
            }}
          >
            Administra las cuentas de acceso
            al despacho IQ. La asignacion a
            usuarios y modulos se realiza desde
            Super Admin / Usuarios.
          </p>
        </header>

        {message ? (
          <div
            style={{
              border:
                "1px solid rgba(96, 165, 250, 0.35)",
              background:
                "rgba(30, 64, 175, 0.22)",
              borderRadius: 12,
              padding: 12,
            }}
          >
            {message}
          </div>
        ) : null}

        {loading ? (
          <section style={panelStyle()}>
            Cargando cuentas IQ...
          </section>
        ) : (
          <section
            style={{
              display: "grid",
              gap: 18,
            }}
          >
            <div style={panelStyle()}>
              <h2
                style={{
                  marginTop: 0,
                }}
              >
                Nueva cuenta IQ
              </h2>

              <div
                style={{
                  display: "grid",
                  gap: 12,
                  gridTemplateColumns:
                    "repeat(auto-fit, minmax(210px, 1fr))",
                }}
              >
                <label
                  style={{
                    display: "grid",
                    gap: 6,
                  }}
                >
                  <span>Alias</span>

                  <input
                    value={alias}
                    onChange={(event) =>
                      setAlias(
                        event.target.value,
                      )
                    }
                    style={inputStyle()}
                    placeholder="Alias"
                    autoComplete="off"
                    name="iq-alias-new"
                  />
                </label>

                <label
                  style={{
                    display: "grid",
                    gap: 6,
                  }}
                >
                  <span>Usuario IQ</span>

                  <input
                    value={username}
                    onChange={(event) =>
                      setUsername(
                        event.target.value,
                      )
                    }
                    style={inputStyle()}
                    placeholder="Usuario"
                    autoComplete="off"
                    name="iq-username-new"
                  />
                </label>

                <label
                  style={{
                    display: "grid",
                    gap: 6,
                  }}
                >
                  <span>
                    Contrasena IQ
                  </span>

                  <div
                    style={{
                      position:
                        "relative",
                    }}
                  >
                    <input
                      value={password}
                      onChange={(event) =>
                        setPassword(
                          event.target.value,
                        )
                      }
                      type={
                        showPassword
                          ? "text"
                          : "password"
                      }
                      style={{
                        ...inputStyle(),
                        paddingRight: 44,
                      }}
                      placeholder="Contrasena"
                      autoComplete="new-password"
                      name="iq-password-new"
                    />

                    <button
                      type="button"
                      onClick={() =>
                        setShowPassword(
                          (current) =>
                            !current,
                        )
                      }
                      aria-label={
                        showPassword
                          ? "Ocultar contrasena"
                          : "Mostrar contrasena"
                      }
                      style={{
                        position:
                          "absolute",
                        right: 8,
                        top: "50%",
                        transform:
                          "translateY(-50%)",
                        border: 0,
                        background:
                          "transparent",
                        color: "white",
                        cursor: "pointer",
                        display:
                          "inline-flex",
                        alignItems:
                          "center",
                        justifyContent:
                          "center",
                      }}
                    >
                      {showPassword ? (
                        <EyeOff
                          size={18}
                        />
                      ) : (
                        <Eye
                          size={18}
                        />
                      )}
                    </button>
                  </div>
                </label>

                <label
                  style={{
                    display: "grid",
                    gap: 6,
                  }}
                >
                  <span>URL ERP IQ</span>

                  <input
                    value={erpUrl}
                    onChange={(event) =>
                      setErpUrl(
                        event.target.value,
                      )
                    }
                    style={inputStyle()}
                    placeholder={
                      DEFAULT_IQ_ERP_URL
                    }
                    autoComplete="off"
                    name="iq-erp-url-new"
                  />
                </label>
              </div>

              <div
                style={{
                  marginTop: 12,
                }}
              >
                <button
                  type="button"
                  disabled={saving}
                  onClick={
                    onCreateProfile
                  }
                  style={buttonStyle(
                    true,
                  )}
                >
                  Crear cuenta IQ
                </button>
              </div>

              <p
                style={{
                  color:
                    "rgba(203, 213, 225, 0.72)",
                  fontSize: 12,
                }}
              >
                La contrasena permanece en
                backend y no se muestra despues
                de guardarse.
              </p>
            </div>

            <div style={panelStyle()}>
              <h2
                style={{
                  marginTop: 0,
                }}
              >
                Cuentas IQ registradas
              </h2>

              <p
                style={{
                  color:
                    "rgba(203, 213, 225, 0.72)",
                  fontSize: 12,
                }}
              >
                Activas: {activeCount}
              </p>

              {profiles.length === 0 ? (
                <p
                  style={{
                    color:
                      "rgba(203, 213, 225, 0.75)",
                  }}
                >
                  Sin cuentas IQ registradas.
                </p>
              ) : (
                <div
                  style={{
                    overflowX: "auto",
                  }}
                >
                  <table
                    style={{
                      width: "100%",
                      borderCollapse:
                        "collapse",
                    }}
                  >
                    <thead>
                      <tr
                        style={{
                          color:
                            "rgba(203, 213, 225, 0.76)",
                          textAlign:
                            "left",
                        }}
                      >
                        <th
                          style={{
                            padding: 10,
                          }}
                        >
                          Alias
                        </th>

                        <th
                          style={{
                            padding: 10,
                          }}
                        >
                          Usuario IQ
                        </th>

                        <th
                          style={{
                            padding: 10,
                          }}
                        >
                          ERP
                        </th>

                        <th
                          style={{
                            padding: 10,
                          }}
                        >
                          Estado
                        </th>

                        <th
                          style={{
                            padding: 10,
                          }}
                        >
                          Password
                        </th>

                        <th
                          style={{
                            padding: 10,
                          }}
                        >
                          Ultima prueba
                        </th>

                        <th
                          style={{
                            padding: 10,
                          }}
                        >
                          Acciones
                        </th>
                      </tr>
                    </thead>

                    <tbody>
                      {profiles.map(
                        (profile) => (
                          <tr
                            key={
                              profile.id
                            }
                            style={{
                              borderTop:
                                "1px solid rgba(148, 163, 184, 0.18)",
                            }}
                          >
                            <td
                              style={{
                                padding: 10,
                              }}
                            >
                              {
                                profile.alias
                              }
                            </td>

                            <td
                              style={{
                                padding: 10,
                              }}
                            >
                              {
                                profile.username
                              }
                            </td>

                            <td
                              style={{
                                padding: 10,
                              }}
                            >
                              {profile.erpUrl ||
                                DEFAULT_IQ_ERP_URL}
                            </td>

                            <td
                              style={{
                                padding: 10,
                              }}
                            >
                              {profile.active
                                ? "Activa"
                                : "Inactiva"}
                            </td>

                            <td
                              style={{
                                padding: 10,
                              }}
                            >
                              {profile.hasPassword
                                ? "Configurada"
                                : "Pendiente"}
                            </td>

                            <td
                              style={{
                                padding: 10,
                              }}
                            >
                              {profile.lastTestMessage ||
                                "-"}
                            </td>

                            <td
                              style={{
                                padding: 10,
                                display:
                                  "flex",
                                gap: 8,
                                flexWrap:
                                  "wrap",
                              }}
                            >
                              <button
                                type="button"
                                disabled={
                                  saving ||
                                  !profile.active
                                }
                                onClick={() =>
                                  onTestProfile(
                                    profile.id,
                                  )
                                }
                                style={buttonStyle()}
                              >
                                Probar
                              </button>

                              <button
                                type="button"
                                disabled={
                                  saving ||
                                  !profile.active
                                }
                                onClick={() =>
                                  onDeactivateProfile(
                                    profile.id,
                                  )
                                }
                                style={buttonStyle()}
                              >
                                Desactivar
                              </button>
                            </td>
                          </tr>
                        ),
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
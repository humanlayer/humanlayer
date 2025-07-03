# VM Infrastructure Integration Testing Specification

## Document Information

- **Version**: 1.0.0
- **Created**: 2025-06-20
- **Classification**: CLEANROOM Specification
- **Status**: Active

## Table of Contents

1. [Overview](#overview)
2. [Testing Framework](#testing-framework)
3. [Integration Test Categories](#integration-test-categories)
4. [Test Scenarios](#test-scenarios)
5. [Testing Infrastructure](#testing-infrastructure)
6. [Quality Assurance](#quality-assurance)
7. [Validation Criteria](#validation-criteria)
8. [Test Scripts](#test-scripts)
9. [Validation Procedures](#validation-procedures)
10. [Quality Gates](#quality-gates)

## Overview

This specification defines the comprehensive integration testing framework for VM infrastructure components, ensuring reliable, secure, and performant virtualized environments.

### Scope

- VM boot and initialization processes
- Service integration and communication
- API endpoints and data flow
- End-to-end user workflows
- Performance and scalability validation
- Security and compliance verification

### Objectives

- Validate VM infrastructure reliability
- Ensure service interoperability
- Verify performance requirements
- Confirm security compliance
- Enable continuous delivery

## Testing Framework

### Test Automation Infrastructure

#### Core Components

```yaml
testing_framework:
  orchestration:
    tool: Terraform + Ansible
    environment: Isolated test clusters
    provisioning: Infrastructure as Code

  execution_engine:
    primary: pytest + testinfra
    secondary: goss for system validation
    ui_testing: Selenium WebDriver
    api_testing: requests + tavern

  reporting:
    results: Allure Reports
    metrics: Prometheus + Grafana
    logs: ELK Stack (Elasticsearch, Logstash, Kibana)
```

#### Test Runner Configuration

```python
# conftest.py - pytest configuration
import pytest
import docker
import paramiko
from typing import Dict, Any

@pytest.fixture(scope="session")
def vm_cluster():
    """Provision test VM cluster"""
    cluster = VMCluster()
    cluster.provision()
    yield cluster
    cluster.cleanup()

@pytest.fixture
def ssh_client(vm_cluster):
    """SSH client for VM access"""
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(
        hostname=vm_cluster.get_host_ip(),
        username='test-user',
        key_filename='test-keys/vm-test-key'
    )
    yield client
    client.close()
```

### Testing Tools and Frameworks

#### Primary Tools Stack

```yaml
tools:
  infrastructure:
    - terraform: '>=1.5.0'
    - ansible: '>=6.0.0'
    - packer: '>=1.9.0'

  testing:
    - pytest: '>=7.0.0'
    - testinfra: '>=8.0.0'
    - goss: '>=0.3.0'
    - tavern: '>=1.24.0'

  monitoring:
    - prometheus: '>=2.40.0'
    - grafana: '>=9.0.0'
    - jaeger: '>=1.40.0'

  security:
    - trivy: '>=0.44.0'
    - clair: '>=4.5.0'
    - owasp-zap: '>=2.12.0'
```

#### Test Environment Management

```bash
#!/bin/bash
# test-env-manager.sh

ENVIRONMENT_CONFIG="environments/test-config.yaml"
TERRAFORM_DIR="terraform/test-environment"

create_test_environment() {
    echo "Provisioning test environment..."
    cd $TERRAFORM_DIR
    terraform init
    terraform plan -var-file="../${ENVIRONMENT_CONFIG}"
    terraform apply -auto-approve -var-file="../${ENVIRONMENT_CONFIG}"
}

destroy_test_environment() {
    echo "Cleaning up test environment..."
    cd $TERRAFORM_DIR
    terraform destroy -auto-approve -var-file="../${ENVIRONMENT_CONFIG}"
}

validate_environment() {
    echo "Validating environment health..."
    ansible-playbook playbooks/health-check.yml
}
```

### Continuous Integration Pipeline

#### GitHub Actions Workflow

```yaml
name: VM Integration Testing
on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  integration_tests:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        vm_type: [ubuntu-22.04, centos-8, debian-11]
        test_suite: [boot, services, api, e2e]

    steps:
      - uses: actions/checkout@v3

      - name: Setup Test Environment
        run: |
          make setup-test-env VM_TYPE=${{ matrix.vm_type }}

      - name: Run Integration Tests
        run: |
          make test-integration SUITE=${{ matrix.test_suite }}

      - name: Generate Reports
        run: |
          make generate-reports

      - name: Upload Test Results
        uses: actions/upload-artifact@v3
        with:
          name: test-results-${{ matrix.vm_type }}-${{ matrix.test_suite }}
          path: reports/

      - name: Cleanup
        if: always()
        run: |
          make cleanup-test-env
```

## Integration Test Categories

### VM Boot and Initialization Testing

#### Boot Process Validation

```python
# tests/test_vm_boot.py
import pytest
import time
from testinfra import get_host

class TestVMBoot:

    def test_vm_starts_successfully(self, vm_cluster):
        """Verify VM boots within acceptable timeframe"""
        start_time = time.time()
        vm = vm_cluster.create_vm("test-boot-vm")
        vm.start()

        # Wait for SSH availability
        max_wait = 300  # 5 minutes
        while time.time() - start_time < max_wait:
            if vm.is_ssh_available():
                break
            time.sleep(5)

        assert vm.is_running()
        assert time.time() - start_time < max_wait

    def test_system_services_start(self, ssh_client):
        """Verify critical system services are running"""
        host = get_host("ssh://test-vm", ssh_client)

        critical_services = [
            "systemd",
            "networkd",
            "resolved",
            "ssh"
        ]

        for service in critical_services:
            assert host.service(service).is_running

    def test_network_connectivity(self, ssh_client):
        """Verify network stack is functional"""
        host = get_host("ssh://test-vm", ssh_client)

        # Test DNS resolution
        cmd = host.run("nslookup google.com")
        assert cmd.rc == 0

        # Test internet connectivity
        cmd = host.run("curl -I https://httpbin.org/status/200")
        assert cmd.rc == 0
        assert "200 OK" in cmd.stdout
```

#### Resource Allocation Testing

```python
# tests/test_resource_allocation.py
class TestResourceAllocation:

    def test_cpu_allocation(self, vm_cluster):
        """Verify CPU cores are allocated correctly"""
        vm = vm_cluster.get_vm("test-vm")
        expected_cores = vm.config.cpu_cores

        host = get_host("ssh://test-vm")
        actual_cores = int(host.run("nproc").stdout.strip())

        assert actual_cores == expected_cores

    def test_memory_allocation(self, vm_cluster):
        """Verify memory allocation matches specification"""
        vm = vm_cluster.get_vm("test-vm")
        expected_memory_mb = vm.config.memory_mb

        host = get_host("ssh://test-vm")
        memory_info = host.run("free -m").stdout
        actual_memory_mb = int(memory_info.split()[7])  # Available memory

        # Allow 5% tolerance for system overhead
        tolerance = expected_memory_mb * 0.05
        assert abs(actual_memory_mb - expected_memory_mb) <= tolerance
```

### Service Integration Testing

#### Inter-Service Communication

```python
# tests/test_service_integration.py
import requests
import json

class TestServiceIntegration:

    def test_api_gateway_to_backend(self, vm_cluster):
        """Test API gateway routes to backend services"""
        gateway_url = vm_cluster.get_service_url("api-gateway")

        # Test health endpoint routing
        response = requests.get(f"{gateway_url}/api/v1/health")
        assert response.status_code == 200

        health_data = response.json()
        assert health_data["status"] == "healthy"
        assert "services" in health_data

    def test_database_connectivity(self, vm_cluster):
        """Verify database service connectivity"""
        db_service = vm_cluster.get_service("database")
        api_service = vm_cluster.get_service("api-backend")

        # Test database connection from API service
        test_query = {
            "query": "SELECT 1 as test_connection",
            "timeout": 5000
        }

        response = requests.post(
            f"{api_service.url}/internal/db-test",
            json=test_query
        )

        assert response.status_code == 200
        assert response.json()["result"][0]["test_connection"] == 1

    def test_message_queue_integration(self, vm_cluster):
        """Test message queue communication"""
        queue_service = vm_cluster.get_service("message-queue")
        producer_service = vm_cluster.get_service("event-producer")
        consumer_service = vm_cluster.get_service("event-consumer")

        # Send test message
        test_message = {"test_id": "integration-test-001", "data": "test"}
        response = requests.post(
            f"{producer_service.url}/send-message",
            json=test_message
        )
        assert response.status_code == 200

        # Verify message consumption
        time.sleep(2)  # Allow processing time
        response = requests.get(
            f"{consumer_service.url}/processed-messages"
        )

        processed_messages = response.json()
        assert any(msg["test_id"] == "integration-test-001"
                  for msg in processed_messages)
```

### API Communication Testing

#### REST API Testing

```yaml
# tests/api/test_rest_endpoints.tavern.yaml
test_name: VM Management API Tests

stages:
  - name: Create VM
    request:
      url: '{api_base_url}/api/v1/vms'
      method: POST
      headers:
        Authorization: 'Bearer {auth_token}'
        Content-Type: 'application/json'
      json:
        name: 'test-vm-api'
        template: 'ubuntu-22.04'
        resources:
          cpu_cores: 2
          memory_mb: 4096
          disk_gb: 50
    response:
      status_code: 201
      json:
        id: !anystr
        name: 'test-vm-api'
        status: 'creating'
      save:
        json:
          vm_id: id

  - name: Wait for VM Ready
    request:
      url: '{api_base_url}/api/v1/vms/{vm_id}/status'
      method: GET
      headers:
        Authorization: 'Bearer {auth_token}'
    response:
      status_code: 200
      json:
        status: 'running'
    delay_after: 30
    max_retries: 10

  - name: Execute Command in VM
    request:
      url: '{api_base_url}/api/v1/vms/{vm_id}/exec'
      method: POST
      headers:
        Authorization: 'Bearer {auth_token}'
      json:
        command: "echo 'Hello, VM!'"
    response:
      status_code: 200
      json:
        exit_code: 0
        stdout: "Hello, VM!\n"

  - name: Delete VM
    request:
      url: '{api_base_url}/api/v1/vms/{vm_id}'
      method: DELETE
      headers:
        Authorization: 'Bearer {auth_token}'
    response:
      status_code: 204
```

### End-to-End Workflow Testing

#### Complete User Journey

```python
# tests/test_e2e_workflows.py
class TestEndToEndWorkflows:

    def test_complete_vm_lifecycle(self, vm_cluster, user_session):
        """Test complete VM lifecycle from user perspective"""

        # Step 1: User logs in
        login_response = user_session.login(
            username="test-user",
            password="test-password"
        )
        assert login_response.status_code == 200

        # Step 2: User creates VM
        vm_request = {
            "name": "e2e-test-vm",
            "template": "ubuntu-22.04",
            "resources": {"cpu": 2, "memory": 4096}
        }

        create_response = user_session.post("/vms", json=vm_request)
        assert create_response.status_code == 201
        vm_id = create_response.json()["id"]

        # Step 3: Wait for VM to be ready
        self.wait_for_vm_ready(user_session, vm_id, timeout=300)

        # Step 4: User accesses VM
        access_response = user_session.post(f"/vms/{vm_id}/access")
        assert access_response.status_code == 200
        access_info = access_response.json()

        # Step 5: User executes commands
        exec_response = user_session.post(
            f"/vms/{vm_id}/exec",
            json={"command": "whoami"}
        )
        assert exec_response.status_code == 200
        assert "test-user" in exec_response.json()["stdout"]

        # Step 6: User stops VM
        stop_response = user_session.post(f"/vms/{vm_id}/stop")
        assert stop_response.status_code == 200

        # Step 7: User deletes VM
        delete_response = user_session.delete(f"/vms/{vm_id}")
        assert delete_response.status_code == 204
```

## Test Scenarios

### Normal Operation Scenarios

#### Standard VM Operations

```python
# tests/scenarios/test_normal_operations.py
class TestNormalOperations:

    @pytest.mark.parametrize("vm_template", [
        "ubuntu-20.04", "ubuntu-22.04", "centos-8", "debian-11"
    ])
    def test_vm_template_deployment(self, vm_cluster, vm_template):
        """Test deployment of different VM templates"""
        vm = vm_cluster.create_vm(
            name=f"test-{vm_template}",
            template=vm_template
        )

        vm.start()
        assert vm.wait_for_ready(timeout=300)

        # Verify template-specific characteristics
        host = get_host(f"ssh://{vm.ip_address}")

        if "ubuntu" in vm_template:
            assert host.file("/etc/lsb-release").exists
            assert "Ubuntu" in host.run("cat /etc/lsb-release").stdout
        elif "centos" in vm_template:
            assert host.file("/etc/centos-release").exists
        elif "debian" in vm_template:
            assert host.file("/etc/debian_version").exists

    def test_vm_scaling_operations(self, vm_cluster):
        """Test VM resource scaling"""
        vm = vm_cluster.create_vm("test-scaling-vm")
        vm.start()

        # Scale up resources
        vm.scale(cpu_cores=4, memory_mb=8192)
        time.sleep(30)  # Allow scaling to complete

        host = get_host(f"ssh://{vm.ip_address}")
        assert int(host.run("nproc").stdout.strip()) == 4

        # Scale down resources
        vm.scale(cpu_cores=2, memory_mb=4096)
        time.sleep(30)

        assert int(host.run("nproc").stdout.strip()) == 2
```

### Error and Failure Scenarios

#### Fault Tolerance Testing

```python
# tests/scenarios/test_failure_scenarios.py
class TestFailureScenarios:

    def test_vm_recovery_after_host_failure(self, vm_cluster):
        """Test VM recovery when host fails"""
        vm = vm_cluster.create_vm("test-recovery-vm")
        vm.start()

        # Simulate host failure
        host_node = vm.get_host_node()
        host_node.simulate_failure()

        # VM should be migrated to another host
        assert vm.wait_for_recovery(timeout=180)
        assert vm.is_running()
        assert vm.get_host_node() != host_node

    def test_network_partition_handling(self, vm_cluster):
        """Test behavior during network partitions"""
        vm = vm_cluster.create_vm("test-partition-vm")
        vm.start()

        # Create network partition
        vm_cluster.create_network_partition([vm])

        # VM should detect partition and handle gracefully
        time.sleep(30)

        # Restore network
        vm_cluster.heal_network_partition()

        # VM should reconnect and resume normal operation
        assert vm.wait_for_network_recovery(timeout=60)

    def test_resource_exhaustion_handling(self, vm_cluster):
        """Test behavior when resources are exhausted"""
        vm = vm_cluster.create_vm("test-resource-vm")
        vm.start()

        # Consume all available memory
        host = get_host(f"ssh://{vm.ip_address}")
        memory_stress_cmd = "stress --vm 1 --vm-bytes 90% --timeout 60s"

        result = host.run(memory_stress_cmd)

        # VM should handle memory pressure gracefully
        assert vm.is_running()
        assert not vm.is_unresponsive()
```

### Performance and Load Testing

#### Performance Benchmarks

```python
# tests/scenarios/test_performance.py
class TestPerformance:

    def test_vm_boot_time_benchmark(self, vm_cluster):
        """Benchmark VM boot times"""
        boot_times = []

        for i in range(10):
            start_time = time.time()
            vm = vm_cluster.create_vm(f"perf-test-{i}")
            vm.start()
            vm.wait_for_ready(timeout=300)
            boot_time = time.time() - start_time
            boot_times.append(boot_time)
            vm.destroy()

        avg_boot_time = sum(boot_times) / len(boot_times)
        max_boot_time = max(boot_times)

        # Performance requirements
        assert avg_boot_time < 120  # Average boot < 2 minutes
        assert max_boot_time < 180  # Max boot < 3 minutes

    def test_concurrent_vm_creation(self, vm_cluster):
        """Test concurrent VM creation performance"""
        import concurrent.futures

        def create_vm(index):
            vm = vm_cluster.create_vm(f"concurrent-{index}")
            start_time = time.time()
            vm.start()
            vm.wait_for_ready(timeout=300)
            return time.time() - start_time

        # Create 20 VMs concurrently
        with concurrent.futures.ThreadPoolExecutor(max_workers=20) as executor:
            futures = [executor.submit(create_vm, i) for i in range(20)]
            boot_times = [future.result() for future in futures]

        # All VMs should boot within acceptable time
        assert all(boot_time < 300 for boot_time in boot_times)
        assert len(boot_times) == 20
```

### Security and Compliance Testing

#### Security Validation

```python
# tests/scenarios/test_security.py
class TestSecurity:

    def test_vm_isolation(self, vm_cluster):
        """Test VM isolation and security boundaries"""
        vm1 = vm_cluster.create_vm("security-test-1")
        vm2 = vm_cluster.create_vm("security-test-2")

        vm1.start()
        vm2.start()

        # VMs should not be able to access each other's filesystems
        host1 = get_host(f"ssh://{vm1.ip_address}")
        host2 = get_host(f"ssh://{vm2.ip_address}")

        # Attempt to access other VM's filesystem
        result = host1.run(f"ping -c 1 {vm2.ip_address}")
        # Ping should fail due to network isolation
        assert result.rc != 0

    def test_encryption_at_rest(self, vm_cluster):
        """Test disk encryption for VMs"""
        vm = vm_cluster.create_vm("encryption-test", encrypted=True)
        vm.start()

        # Verify disk encryption is active
        host = get_host(f"ssh://{vm.ip_address}")

        # Check for LUKS encryption
        result = host.run("lsblk -f")
        assert "crypto_LUKS" in result.stdout

    def test_vulnerability_scanning(self, vm_cluster):
        """Test VM images for security vulnerabilities"""
        vm = vm_cluster.create_vm("vuln-scan-test")
        vm.start()

        # Run Trivy security scan
        scan_result = vm.run_security_scan("trivy")

        # No HIGH or CRITICAL vulnerabilities allowed
        assert scan_result.high_vulnerabilities == 0
        assert scan_result.critical_vulnerabilities == 0
```

## Testing Infrastructure

### Test Environment Provisioning

#### Terraform Configuration

```hcl
# terraform/test-environment/main.tf
variable "environment_name" {
  description = "Name of the test environment"
  type        = string
}

variable "vm_count" {
  description = "Number of test VMs to provision"
  type        = number
  default     = 5
}

resource "aws_vpc" "test_vpc" {
  cidr_block           = "10.0.0.0/16"
  enable_dns_hostnames = true
  enable_dns_support   = true

  tags = {
    Name        = "${var.environment_name}-vpc"
    Environment = "test"
    Purpose     = "integration-testing"
  }
}

resource "aws_subnet" "test_subnet" {
  vpc_id                  = aws_vpc.test_vpc.id
  cidr_block              = "10.0.1.0/24"
  availability_zone       = data.aws_availability_zones.available.names[0]
  map_public_ip_on_launch = true

  tags = {
    Name = "${var.environment_name}-subnet"
  }
}

resource "aws_instance" "test_vms" {
  count                  = var.vm_count
  ami                    = data.aws_ami.test_image.id
  instance_type          = "t3.medium"
  subnet_id              = aws_subnet.test_subnet.id
  vpc_security_group_ids = [aws_security_group.test_sg.id]
  key_name               = aws_key_pair.test_key.key_name

  user_data = file("${path.module}/user-data.sh")

  tags = {
    Name = "${var.environment_name}-vm-${count.index + 1}"
    Type = "test-vm"
  }
}
```

### Test Data Management

#### Test Data Generator

```python
# tests/utils/test_data_generator.py
import faker
import json
import random
from typing import Dict, List, Any

class TestDataGenerator:

    def __init__(self):
        self.fake = faker.Faker()

    def generate_vm_configs(self, count: int) -> List[Dict[str, Any]]:
        """Generate test VM configurations"""
        templates = ["ubuntu-20.04", "ubuntu-22.04", "centos-8", "debian-11"]
        vm_configs = []

        for i in range(count):
            config = {
                "name": f"test-vm-{i+1:03d}",
                "template": random.choice(templates),
                "resources": {
                    "cpu_cores": random.choice([1, 2, 4, 8]),
                    "memory_mb": random.choice([1024, 2048, 4096, 8192]),
                    "disk_gb": random.choice([20, 50, 100])
                },
                "network": {
                    "subnet": "test-subnet",
                    "security_groups": ["test-sg"]
                },
                "metadata": {
                    "owner": self.fake.email(),
                    "project": self.fake.company(),
                    "created_by": "integration-test"
                }
            }
            vm_configs.append(config)

        return vm_configs

    def generate_test_users(self, count: int) -> List[Dict[str, str]]:
        """Generate test user accounts"""
        users = []

        for i in range(count):
            user = {
                "username": f"testuser{i+1:03d}",
                "email": self.fake.email(),
                "password": self.fake.password(length=12),
                "first_name": self.fake.first_name(),
                "last_name": self.fake.last_name(),
                "role": random.choice(["user", "admin", "operator"])
            }
            users.append(user)

        return users
```

### Test Result Reporting

#### Allure Report Configuration

```python
# tests/conftest.py - Allure integration
import allure
import pytest
import os
from datetime import datetime

@pytest.hookimpl(tryfirst=True)
def pytest_configure(config):
    """Configure Allure reporting"""
    if not os.path.exists("reports"):
        os.makedirs("reports")

    # Set environment information
    allure.environment(
        Environment="Test",
        Test_Run_ID=os.environ.get("TEST_RUN_ID", "local"),
        Build_Number=os.environ.get("BUILD_NUMBER", "0"),
        Timestamp=datetime.now().isoformat()
    )

@pytest.fixture(autouse=True)
def allure_test_metadata(request):
    """Add metadata to Allure reports"""
    test_name = request.node.name
    test_file = request.node.fspath.basename

    allure.dynamic.feature(test_file.replace("test_", "").replace(".py", ""))
    allure.dynamic.story(test_name)

    if hasattr(request.node, 'get_closest_marker'):
        if request.node.get_closest_marker('critical'):
            allure.dynamic.severity('critical')
        elif request.node.get_closest_marker('high'):
            allure.dynamic.severity('high')
        else:
            allure.dynamic.severity('normal')
```

## Quality Assurance

### Code Quality Metrics

#### Code Coverage Requirements

```yaml
# .coveragerc
[run]
source = src/
omit =
    */tests/*
    */venv/*
    */migrations/*
    setup.py

[report]
exclude_lines =
    pragma: no cover
    def __repr__
    raise AssertionError
    raise NotImplementedError

# Minimum coverage thresholds
fail_under = 85
precision = 2
show_missing = True
```

#### Static Code Analysis

```yaml
# .pre-commit-config.yaml
repos:
  - repo: https://github.com/psf/black
    rev: 22.3.0
    hooks:
      - id: black
        language_version: python3.9

  - repo: https://github.com/pycqa/flake8
    rev: 4.0.1
    hooks:
      - id: flake8
        additional_dependencies: [flake8-docstrings]

  - repo: https://github.com/pycqa/isort
    rev: 5.10.1
    hooks:
      - id: isort
        args: ['--profile', 'black']

  - repo: https://github.com/pre-commit/mirrors-mypy
    rev: v0.942
    hooks:
      - id: mypy
        additional_dependencies: [types-requests]
```

### Performance Benchmarking

#### Performance Test Suite

```python
# tests/performance/test_benchmarks.py
import pytest
import time
import statistics
from typing import List

class TestPerformanceBenchmarks:

    @pytest.mark.benchmark
    def test_api_response_time(self, vm_cluster):
        """Benchmark API response times"""
        response_times = []

        for _ in range(100):
            start_time = time.time()
            response = vm_cluster.api_client.get("/health")
            end_time = time.time()

            assert response.status_code == 200
            response_times.append(end_time - start_time)

        avg_response_time = statistics.mean(response_times)
        p95_response_time = statistics.quantiles(response_times, n=20)[18]  # 95th percentile

        # Performance requirements
        assert avg_response_time < 0.1  # 100ms average
        assert p95_response_time < 0.5  # 500ms 95th percentile

    @pytest.mark.benchmark
    def test_vm_creation_throughput(self, vm_cluster):
        """Benchmark VM creation throughput"""
        import concurrent.futures

        def create_and_destroy_vm(index):
            start_time = time.time()
            vm = vm_cluster.create_vm(f"throughput-test-{index}")
            vm.start()
            vm.wait_for_ready(timeout=300)
            vm.destroy()
            return time.time() - start_time

        # Test concurrent VM creation
        with concurrent.futures.ThreadPoolExecutor(max_workers=10) as executor:
            start_time = time.time()
            futures = [executor.submit(create_and_destroy_vm, i) for i in range(50)]
            results = [future.result() for future in futures]
            total_time = time.time() - start_time

        throughput = len(results) / total_time  # VMs per second

        # Throughput requirement: at least 0.5 VMs per second
        assert throughput >= 0.5
```

### Security Vulnerability Scanning

#### Security Test Suite

```python
# tests/security/test_vulnerability_scanning.py
import subprocess
import json

class TestSecurityScanning:

    def test_container_image_vulnerabilities(self):
        """Scan container images for vulnerabilities"""
        images = [
            "vm-management-api:latest",
            "vm-agent:latest",
            "vm-proxy:latest"
        ]

        for image in images:
            # Run Trivy scan
            result = subprocess.run([
                "trivy", "image", "--format", "json",
                "--severity", "HIGH,CRITICAL", image
            ], capture_output=True, text=True)

            scan_data = json.loads(result.stdout)

            # Count vulnerabilities
            high_vulns = 0
            critical_vulns = 0

            for result in scan_data.get("Results", []):
                for vuln in result.get("Vulnerabilities", []):
                    if vuln["Severity"] == "HIGH":
                        high_vulns += 1
                    elif vuln["Severity"] == "CRITICAL":
                        critical_vulns += 1

            # Security requirements
            assert critical_vulns == 0, f"Critical vulnerabilities found in {image}"
            assert high_vulns <= 5, f"Too many high vulnerabilities in {image}"

    def test_network_security_scan(self, vm_cluster):
        """Test network security configuration"""
        vm = vm_cluster.create_vm("security-scan-vm")
        vm.start()

        # Run nmap security scan
        result = subprocess.run([
            "nmap", "-sS", "-O", vm.ip_address
        ], capture_output=True, text=True)

        # Verify only expected ports are open
        expected_ports = ["22/tcp", "80/tcp", "443/tcp"]
        open_ports = []

        for line in result.stdout.split('\n'):
            if "/tcp" in line and "open" in line:
                port = line.split()[0]
                open_ports.append(port)

        unexpected_ports = set(open_ports) - set(expected_ports)
        assert len(unexpected_ports) == 0, f"Unexpected open ports: {unexpected_ports}"
```

## Validation Criteria

### Acceptance Criteria Definition

#### Test Categories and Requirements

```yaml
acceptance_criteria:
  boot_testing:
    requirements:
      - VM boots successfully within 3 minutes
      - All system services start correctly
      - Network connectivity is established
      - Resource allocation matches specification
    success_threshold: 100%

  service_integration:
    requirements:
      - API endpoints respond within SLA
      - Service-to-service communication works
      - Database connections are stable
      - Message queues process messages
    success_threshold: 99%

  performance:
    requirements:
      - API response time < 100ms average
      - VM creation time < 2 minutes average
      - Concurrent VM limit: 100 VMs per host
      - Resource utilization < 80%
    success_threshold: 95%

  security:
    requirements:
      - No critical vulnerabilities
      - Network isolation between VMs
      - Encryption at rest enabled
      - Access controls enforced
    success_threshold: 100%
```

### Success Metrics and KPIs

#### Key Performance Indicators

```python
# tests/metrics/kpi_calculator.py
from dataclasses import dataclass
from typing import List, Dict

@dataclass
class TestKPIs:
    total_tests: int
    passed_tests: int
    failed_tests: int
    skipped_tests: int
    avg_execution_time: float
    test_coverage: float

    @property
    def success_rate(self) -> float:
        return self.passed_tests / self.total_tests * 100

    @property
    def failure_rate(self) -> float:
        return self.failed_tests / self.total_tests * 100

class KPICalculator:

    def calculate_integration_kpis(self, test_results: Dict) -> TestKPIs:
        """Calculate integration test KPIs"""
        return TestKPIs(
            total_tests=test_results["total"],
            passed_tests=test_results["passed"],
            failed_tests=test_results["failed"],
            skipped_tests=test_results["skipped"],
            avg_execution_time=test_results["avg_duration"],
            test_coverage=test_results["coverage_percentage"]
        )

    def generate_kpi_report(self, kpis: TestKPIs) -> str:
        """Generate KPI report"""
        return f"""
        Integration Test KPIs
        ====================
        Total Tests: {kpis.total_tests}
        Success Rate: {kpis.success_rate:.2f}%
        Failure Rate: {kpis.failure_rate:.2f}%
        Average Execution Time: {kpis.avg_execution_time:.2f}s
        Test Coverage: {kpis.test_coverage:.2f}%
        """
```

### Failure Criteria and Thresholds

#### Failure Threshold Configuration

```yaml
failure_thresholds:
  critical_failures:
    - VM boot failure rate > 1%
    - Security vulnerability (Critical severity)
    - Data corruption or loss
    - Service downtime > 5 minutes

  major_failures:
    - API response time > 1 second
    - VM creation failure rate > 5%
    - Memory leak detection
    - Network connectivity issues

  minor_failures:
    - Test coverage < 85%
    - Performance degradation > 20%
    - Documentation gaps
    - Non-critical warnings

escalation_rules:
  critical: 'Immediate escalation to on-call team'
  major: 'Escalation within 4 hours'
  minor: 'Address in next sprint'
```

## Test Scripts

### Master Test Execution Script

```bash
#!/bin/bash
# run-integration-tests.sh

set -euo pipefail

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
TEST_ENV_NAME="integration-test-$(date +%s)"
PARALLEL_JOBS=${PARALLEL_JOBS:-4}

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() {
    echo -e "${GREEN}[$(date +'%Y-%m-%d %H:%M:%S')] $1${NC}"
}

warn() {
    echo -e "${YELLOW}[$(date +'%Y-%m-%d %H:%M:%S')] WARNING: $1${NC}"
}

error() {
    echo -e "${RED}[$(date +'%Y-%m-%d %H:%M:%S')] ERROR: $1${NC}"
}

cleanup() {
    log "Cleaning up test environment..."
    if [ -n "${TEST_ENV_CREATED:-}" ]; then
        make destroy-test-env ENV_NAME="$TEST_ENV_NAME" || warn "Failed to destroy test environment"
    fi
}

trap cleanup EXIT

main() {
    log "Starting VM Infrastructure Integration Tests"

    # Validate prerequisites
    log "Validating prerequisites..."
    command -v terraform >/dev/null 2>&1 || { error "terraform is required"; exit 1; }
    command -v ansible >/dev/null 2>&1 || { error "ansible is required"; exit 1; }
    command -v pytest >/dev/null 2>&1 || { error "pytest is required"; exit 1; }

    # Create test environment
    log "Creating test environment: $TEST_ENV_NAME"
    make create-test-env ENV_NAME="$TEST_ENV_NAME"
    TEST_ENV_CREATED=1

    # Wait for environment to be ready
    log "Waiting for test environment to be ready..."
    make wait-for-env ENV_NAME="$TEST_ENV_NAME" TIMEOUT=600

    # Export environment variables
    export TEST_ENV_NAME
    export TEST_API_URL="https://${TEST_ENV_NAME}-api.test.local"
    export TEST_SSH_KEY="${PROJECT_ROOT}/test-keys/integration-test-key"

    # Run test suites
    log "Running integration test suites..."

    # Boot and initialization tests
    log "Running VM boot tests..."
    pytest tests/test_vm_boot.py -v --tb=short --junit-xml=reports/boot-tests.xml

    # Service integration tests
    log "Running service integration tests..."
    pytest tests/test_service_integration.py -v --tb=short --junit-xml=reports/service-tests.xml

    # API communication tests
    log "Running API tests..."
    pytest tests/api/ -v --tb=short --junit-xml=reports/api-tests.xml

    # End-to-end workflow tests
    log "Running E2E tests..."
    pytest tests/test_e2e_workflows.py -v --tb=short --junit-xml=reports/e2e-tests.xml

    # Performance tests
    log "Running performance tests..."
    pytest tests/performance/ -v --tb=short --junit-xml=reports/performance-tests.xml -m benchmark

    # Security tests
    log "Running security tests..."
    pytest tests/security/ -v --tb=short --junit-xml=reports/security-tests.xml

    # Generate reports
    log "Generating test reports..."
    allure generate reports/allure-results -o reports/allure-report --clean

    # Calculate KPIs
    log "Calculating test KPIs..."
    python tests/metrics/kpi_calculator.py reports/

    log "Integration tests completed successfully!"
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi
```

## Validation Procedures

### Pre-Test Validation

```python
# tests/validation/pre_test_validation.py
import subprocess
import requests
import time
from typing import List, Dict, Any

class PreTestValidator:

    def __init__(self, environment_config: Dict[str, Any]):
        self.config = environment_config
        self.validation_errors = []

    def validate_environment(self) -> bool:
        """Run comprehensive pre-test validation"""
        validations = [
            self.validate_infrastructure,
            self.validate_services,
            self.validate_network_connectivity,
            self.validate_test_data,
            self.validate_credentials
        ]

        for validation in validations:
            try:
                validation()
            except Exception as e:
                self.validation_errors.append(str(e))

        return len(self.validation_errors) == 0

    def validate_infrastructure(self):
        """Validate test infrastructure is ready"""
        # Check if VMs are running
        result = subprocess.run([
            "terraform", "output", "-json"
        ], capture_output=True, text=True, cwd="terraform/test-environment")

        if result.returncode != 0:
            raise Exception("Failed to get terraform output")

        # Validate VM count
        vm_ips = json.loads(result.stdout)["vm_ips"]["value"]
        expected_count = self.config["vm_count"]

        if len(vm_ips) != expected_count:
            raise Exception(f"Expected {expected_count} VMs, found {len(vm_ips)}")

    def validate_services(self):
        """Validate all services are healthy"""
        services = [
            "api-gateway",
            "vm-management-api",
            "database",
            "message-queue"
        ]

        for service in services:
            health_url = f"http://{service}.test.local/health"
            response = requests.get(health_url, timeout=10)

            if response.status_code != 200:
                raise Exception(f"Service {service} health check failed")

            health_data = response.json()
            if health_data.get("status") != "healthy":
                raise Exception(f"Service {service} is not healthy")

    def get_validation_report(self) -> str:
        """Generate validation report"""
        if not self.validation_errors:
            return "✅ All pre-test validations passed"

        report = "❌ Pre-test validation failures:\n"
        for i, error in enumerate(self.validation_errors, 1):
            report += f"{i}. {error}\n"

        return report
```

### Post-Test Validation

```python
# tests/validation/post_test_validation.py
class PostTestValidator:

    def __init__(self, test_results: Dict[str, Any]):
        self.results = test_results

    def validate_test_completion(self) -> bool:
        """Validate all tests completed successfully"""
        required_test_suites = [
            "boot_tests",
            "service_integration_tests",
            "api_tests",
            "e2e_tests",
            "performance_tests",
            "security_tests"
        ]

        for suite in required_test_suites:
            if suite not in self.results:
                return False

            if self.results[suite]["status"] != "completed":
                return False

        return True

    def validate_coverage_requirements(self) -> bool:
        """Validate test coverage meets requirements"""
        min_coverage = 85.0
        actual_coverage = self.results.get("coverage", {}).get("percentage", 0)

        return actual_coverage >= min_coverage

    def validate_performance_requirements(self) -> bool:
        """Validate performance requirements are met"""
        perf_results = self.results.get("performance_tests", {})

        requirements = {
            "avg_api_response_time": 0.1,  # 100ms
            "vm_boot_time": 120,  # 2 minutes
            "concurrent_vm_limit": 100
        }

        for metric, threshold in requirements.items():
            actual_value = perf_results.get(metric, float('inf'))
            if actual_value > threshold:
                return False

        return True
```

## Quality Gates

### Quality Gate Configuration

```yaml
# quality-gates.yaml
quality_gates:
  mandatory_gates:
    - name: 'Test Success Rate'
      metric: 'test_success_rate'
      threshold: 95.0
      operator: '>='
      blocking: true

    - name: 'No Critical Vulnerabilities'
      metric: 'critical_vulnerabilities'
      threshold: 0
      operator: '=='
      blocking: true

    - name: 'Code Coverage'
      metric: 'code_coverage'
      threshold: 85.0
      operator: '>='
      blocking: true

    - name: 'Performance Regression'
      metric: 'performance_regression'
      threshold: 10.0
      operator: '<='
      blocking: true

  advisory_gates:
    - name: 'Documentation Coverage'
      metric: 'doc_coverage'
      threshold: 80.0
      operator: '>='
      blocking: false

    - name: 'Technical Debt'
      metric: 'technical_debt_ratio'
      threshold: 5.0
      operator: '<='
      blocking: false

gate_evaluation:
  failure_action: 'block_deployment'
  notification_channels:
    - slack: '#engineering-alerts'
    - email: 'team-leads@company.com'

  reporting:
    format: 'junit_xml'
    output_path: 'reports/quality-gates.xml'
```

### Quality Gate Evaluator

```python
# tests/quality_gates/evaluator.py
import yaml
from typing import Dict, List, Any, Tuple
from dataclasses import dataclass

@dataclass
class QualityGateResult:
    name: str
    status: str  # "passed", "failed", "warning"
    actual_value: float
    threshold: float
    blocking: bool
    message: str

class QualityGateEvaluator:

    def __init__(self, config_path: str):
        with open(config_path, 'r') as f:
            self.config = yaml.safe_load(f)

    def evaluate_gates(self, metrics: Dict[str, Any]) -> List[QualityGateResult]:
        """Evaluate all quality gates"""
        results = []

        # Evaluate mandatory gates
        for gate in self.config["quality_gates"]["mandatory_gates"]:
            result = self._evaluate_gate(gate, metrics)
            results.append(result)

        # Evaluate advisory gates
        for gate in self.config["quality_gates"]["advisory_gates"]:
            result = self._evaluate_gate(gate, metrics)
            results.append(result)

        return results

    def _evaluate_gate(self, gate: Dict, metrics: Dict) -> QualityGateResult:
        """Evaluate a single quality gate"""
        name = gate["name"]
        metric_key = gate["metric"]
        threshold = gate["threshold"]
        operator = gate["operator"]
        blocking = gate["blocking"]

        actual_value = metrics.get(metric_key, 0)

        # Evaluate condition
        if operator == ">=":
            passed = actual_value >= threshold
        elif operator == "<=":
            passed = actual_value <= threshold
        elif operator == "==":
            passed = actual_value == threshold
        elif operator == ">":
            passed = actual_value > threshold
        elif operator == "<":
            passed = actual_value < threshold
        else:
            passed = False

        status = "passed" if passed else ("failed" if blocking else "warning")
        message = self._generate_message(name, actual_value, threshold, operator, passed)

        return QualityGateResult(
            name=name,
            status=status,
            actual_value=actual_value,
            threshold=threshold,
            blocking=blocking,
            message=message
        )

    def _generate_message(self, name: str, actual: float, threshold: float,
                         operator: str, passed: bool) -> str:
        """Generate quality gate message"""
        status_icon = "✅" if passed else "❌"
        return f"{status_icon} {name}: {actual} {operator} {threshold}"

    def generate_report(self, results: List[QualityGateResult]) -> str:
        """Generate quality gate report"""
        report = "Quality Gate Evaluation Report\n"
        report += "=" * 40 + "\n\n"

        passed_gates = [r for r in results if r.status == "passed"]
        failed_gates = [r for r in results if r.status == "failed"]
        warning_gates = [r for r in results if r.status == "warning"]

        report += f"Summary:\n"
        report += f"  Passed: {len(passed_gates)}\n"
        report += f"  Failed: {len(failed_gates)}\n"
        report += f"  Warnings: {len(warning_gates)}\n\n"

        if failed_gates:
            report += "BLOCKING FAILURES:\n"
            for result in failed_gates:
                report += f"  {result.message}\n"
            report += "\n"

        if warning_gates:
            report += "WARNINGS:\n"
            for result in warning_gates:
                report += f"  {result.message}\n"
            report += "\n"

        # Overall status
        overall_status = "PASSED" if not failed_gates else "FAILED"
        report += f"Overall Status: {overall_status}\n"

        return report
```

---

## Appendix

### Test Environment Specifications

- **Minimum Hardware**: 32 vCPUs, 128GB RAM, 2TB storage
- **Network Requirements**: Isolated test network with internet access
- **Security Requirements**: Encrypted storage, network isolation, audit logging
- **Backup Strategy**: Automated snapshots before/after test runs

### Tool Versions and Dependencies

- **Python**: 3.9+
- **Terraform**: 1.5.0+
- **Ansible**: 6.0.0+
- **Docker**: 20.10+
- **Kubernetes**: 1.25+ (if applicable)

### Contact Information

- **Test Engineering Team**: test-engineering@company.com
- **Infrastructure Team**: infrastructure@company.com
- **Security Team**: security@company.com

---

_This specification is maintained by the Test Engineering team and is updated with each major release._

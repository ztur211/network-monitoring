import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Modal,
} from 'react-native';
import { CircuitDto } from '@nodescope/shared';
import {
  useCircuitStore,
  CreateCircuitInput,
  UpdateCircuitInput,
} from '../../store/circuits.store';
import { useDeviceStore } from '../../store/device.store';
import { CircuitForm } from '../../components/CircuitForm';

type FormMode = 'create' | 'edit' | null;

export default function CircuitsScreen() {
  const { circuits, isLoading, loaded, error, loadCircuits, nextCursor, total, loadNextPage, createCircuit, updateCircuit, deleteCircuit } =
    useCircuitStore();
  const { loadDevices, loaded: devicesLoaded } = useDeviceStore();

  const [formMode, setFormMode] = useState<FormMode>(null);
  const [editCircuit, setEditCircuit] = useState<CircuitDto | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    void loadCircuits();
    if (!devicesLoaded) void loadDevices();
  }, []);

  const handleDelete = useCallback(
    (circuit: CircuitDto) => {
      Alert.alert(
        'Delete Circuit',
        `Delete "${circuit.ispName} — ${circuit.serviceType}"? This cannot be undone.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: async () => {
              try {
                await deleteCircuit(circuit.id);
              } catch {
                Alert.alert('Error', 'Failed to delete circuit.');
              }
            },
          },
        ],
      );
    },
    [deleteCircuit],
  );

  const handleFormSubmit = useCallback(
    async (input: CreateCircuitInput | UpdateCircuitInput) => {
      setIsSubmitting(true);
      try {
        if (formMode === 'create') {
          await createCircuit(input as CreateCircuitInput);
        } else if (formMode === 'edit' && editCircuit) {
          await updateCircuit(editCircuit.id, editCircuit, input as UpdateCircuitInput);
        }
        setFormMode(null);
        setEditCircuit(null);
      } catch {
        Alert.alert('Error', 'Failed to save circuit. Queued for retry.');
        setFormMode(null);
        setEditCircuit(null);
      } finally {
        setIsSubmitting(false);
      }
    },
    [formMode, editCircuit, createCircuit, updateCircuit],
  );

  const renderCircuit = useCallback(
    ({ item }: { item: CircuitDto }) => (
      <CircuitCard
        circuit={item}
        onEdit={() => {
          setEditCircuit(item);
          setFormMode('edit');
        }}
        onDelete={() => handleDelete(item)}
      />
    ),
    [handleDelete],
  );

  if (isLoading && circuits.length === 0) {
    return (
      <View className="flex-1 items-center justify-center bg-white dark:bg-gray-900">
        <ActivityIndicator size="large" color="#2563eb" />
      </View>
    );
  }

  if (error && circuits.length === 0) {
    return (
      <View className="flex-1 items-center justify-center bg-white dark:bg-gray-900 px-8">
        <Text className="text-red-500 dark:text-red-400 text-center mb-4">{error}</Text>
        <TouchableOpacity
          onPress={() => void loadCircuits()}
          className="bg-blue-600 px-6 py-2 rounded-lg"
        >
          <Text className="text-white font-medium">Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-white dark:bg-gray-900">
      {/* Header */}
      <View className="px-4 pt-12 pb-3 border-b border-gray-200 dark:border-gray-700">
        <View className="flex-row items-center justify-between">
          <View>
            <Text className="text-2xl font-bold text-gray-900 dark:text-white">Circuits</Text>
            {loaded && (
              <Text className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                {total} {total === 1 ? 'circuit' : 'circuits'}
              </Text>
            )}
          </View>
          <TouchableOpacity
            onPress={() => setFormMode('create')}
            className="bg-blue-600 px-4 py-2 rounded-lg"
          >
            <Text className="text-white font-medium">+ Add</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* List */}
      {circuits.length === 0 && loaded ? (
        <View className="flex-1 items-center justify-center px-8">
          <Text className="text-gray-400 dark:text-gray-500 text-center text-lg font-medium mb-2">
            No circuits yet
          </Text>
          <Text className="text-gray-400 dark:text-gray-500 text-center text-sm mb-6">
            Document your ISP circuits — fiber, cable, leased lines, and more.
          </Text>
          <TouchableOpacity
            onPress={() => setFormMode('create')}
            className="bg-blue-600 px-6 py-3 rounded-lg"
          >
            <Text className="text-white font-medium">Add First Circuit</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={circuits}
          keyExtractor={(item) => item.id}
          renderItem={renderCircuit}
          contentContainerStyle={{ paddingBottom: 24 }}
          onEndReached={() => void loadNextPage()}
          onEndReachedThreshold={0.3}
          ListFooterComponent={
            isLoading && circuits.length > 0 ? (
              <View className="py-4 items-center">
                <ActivityIndicator size="small" color="#2563eb" />
              </View>
            ) : nextCursor ? (
              <TouchableOpacity
                onPress={() => void loadNextPage()}
                className="py-4 items-center"
              >
                <Text className="text-blue-600 dark:text-blue-400 text-sm">Load more</Text>
              </TouchableOpacity>
            ) : null
          }
        />
      )}

      {/* Create / Edit form modal */}
      <Modal visible={formMode !== null} animationType="slide" presentationStyle="pageSheet">
        <CircuitForm
          mode={formMode === 'edit' ? 'edit' : 'create'}
          circuit={editCircuit ?? undefined}
          onSubmit={handleFormSubmit}
          onCancel={() => {
            setFormMode(null);
            setEditCircuit(null);
          }}
          isSubmitting={isSubmitting}
        />
      </Modal>
    </View>
  );
}

function CircuitCard({
  circuit,
  onEdit,
  onDelete,
}: {
  circuit: CircuitDto;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <View className="mx-4 mt-3 bg-gray-50 dark:bg-gray-800 rounded-xl p-4">
      <View className="flex-row items-start justify-between mb-1">
        <View className="flex-1 mr-3">
          <Text className="text-base font-semibold text-gray-900 dark:text-white">
            {circuit.ispName}
          </Text>
          <Text className="text-sm text-gray-600 dark:text-gray-400">{circuit.serviceType}</Text>
        </View>
        {circuit.bandwidth !== null && (
          <View className="bg-blue-100 dark:bg-blue-900/40 px-2 py-0.5 rounded-full">
            <Text className="text-xs font-medium text-blue-700 dark:text-blue-300">
              {circuit.bandwidth >= 1000
                ? `${circuit.bandwidth / 1000} Gbps`
                : `${circuit.bandwidth} Mbps`}
            </Text>
          </View>
        )}
      </View>

      {circuit.circuitId && (
        <Text className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          Circuit ID: {circuit.circuitId}
        </Text>
      )}

      {circuit.notes && (
        <Text className="text-xs text-gray-500 dark:text-gray-400 mt-1" numberOfLines={2}>
          {circuit.notes}
        </Text>
      )}

      <View className="flex-row gap-3 mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
        <TouchableOpacity onPress={onEdit} className="flex-1 items-center py-1.5">
          <Text className="text-sm text-blue-600 dark:text-blue-400 font-medium">Edit</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onDelete} className="flex-1 items-center py-1.5">
          <Text className="text-sm text-red-500 dark:text-red-400 font-medium">Delete</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
